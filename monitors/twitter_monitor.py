"""
Twitter Monitor for BankrBot.

Polls @bankrbot's recent tweets for token deployment announcements.
Uses the SocialData API (socialdata.tools) — a reliable paid scraping service
that costs ~$0.20 per 1,000 tweets (~$5-10/month for our use case).

When a deployment is detected, traces back to the ORIGINAL tweet author —
the person whose content inspired the coin, not the random person who tagged bankrbot.
"""

import re
import logging
import asyncio
from datetime import datetime, timezone
from urllib.parse import quote

import aiohttp

import config

logger = logging.getLogger(__name__)

SOCIALDATA_BASE = "https://api.socialdata.tools"

# Patterns BankrBot uses when announcing deployments
CA_PATTERN = re.compile(r"0x[a-fA-F0-9]{40}")
TICKER_PATTERN = re.compile(r"\$([A-Za-z0-9]+)")
DEPLOYED_KEYWORDS = ["deployed", "created", "launched", "live on base", "token is live"]


class TwitterMonitor:
    def __init__(self, on_deployment_detected):
        """
        Args:
            on_deployment_detected: async callback(deployment_info: dict)
        """
        self.on_deployment_detected = on_deployment_detected
        self._seen_tweet_ids = set()
        self._session = None

    def _headers(self):
        return {
            "Authorization": f"Bearer {config.SOCIALDATA_API_KEY}",
            "Accept": "application/json",
        }

    async def _ensure_session(self):
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()

    async def _api_get(self, url):
        """Make a GET request to SocialData API. Returns parsed JSON or None."""
        await self._ensure_session()
        try:
            async with self._session.get(url, headers=self._headers()) as resp:
                if resp.status == 200:
                    return await resp.json()
                if resp.status == 402:
                    logger.error("SocialData API: insufficient balance — top up at socialdata.tools")
                    return None
                if resp.status == 429:
                    logger.warning("SocialData API: rate limited, backing off")
                    return None
                body = await resp.text()
                logger.error(f"SocialData API error {resp.status}: {body[:200]}")
                return None
        except Exception as e:
            logger.error(f"SocialData API request failed: {e}")
            return None

    async def _get_bankrbot_tweets(self):
        """Fetch recent tweets from @bankrbot using the search endpoint."""
        query = quote(f"from:{config.BANKRBOT_USERNAME}")
        url = f"{SOCIALDATA_BASE}/twitter/search?query={query}&type=Latest"
        data = await self._api_get(url)
        if data and "tweets" in data:
            return data["tweets"]
        return []

    async def _get_tweet_by_id(self, tweet_id):
        """Fetch a single tweet by its ID."""
        url = f"{SOCIALDATA_BASE}/twitter/statuses/show?id={tweet_id}"
        return await self._api_get(url)

    async def _get_user_profile(self, username):
        """Fetch a user profile by screen name."""
        url = f"{SOCIALDATA_BASE}/twitter/user/{quote(username)}"
        return await self._api_get(url)

    async def _trace_original_author(self, tweet):
        """
        Trace back up the reply chain to find the original tweet author.

        Typical chain:
          1. Original Author tweets something
          2. Random person replies tagging @bankrbot
          3. BankrBot replies with deployment announcement

        We want the Original Author from step 1, not the random caller from step 2.
        """
        current_tweet = tweet
        max_depth = 5

        for _ in range(max_depth):
            reply_to_id = current_tweet.get("in_reply_to_status_id_str")
            if not reply_to_id:
                break

            parent_tweet = await self._get_tweet_by_id(reply_to_id)
            if not parent_tweet:
                break
            current_tweet = parent_tweet

        user = current_tweet.get("user", {})
        screen_name = user.get("screen_name")
        tweet_id = current_tweet.get("id_str", "")
        return {
            "username": screen_name,
            "user_id": user.get("id_str"),
            "tweet_id": tweet_id,
            "tweet_text": current_tweet.get("full_text") or current_tweet.get("text", ""),
            "tweet_url": f"https://x.com/{screen_name}/status/{tweet_id}" if screen_name else None,
        }

    def _parse_deployment_tweet(self, tweet):
        """Parse a BankrBot tweet to extract deployment info."""
        tweet_text = tweet.get("full_text") or tweet.get("text", "")
        text_lower = tweet_text.lower()

        is_deployment = any(kw in text_lower for kw in DEPLOYED_KEYWORDS)
        if not is_deployment:
            return None

        ca_match = CA_PATTERN.search(tweet_text)
        contract_address = ca_match.group(0) if ca_match else None

        ticker_match = TICKER_PATTERN.search(tweet_text)
        ticker = ticker_match.group(1) if ticker_match else None

        tweet_id = tweet.get("id_str", "")
        return {
            "source": "twitter",
            "tweet_id": tweet_id,
            "tweet_text": tweet_text,
            "contract_address": contract_address,
            "ticker": ticker,
            "bankrbot_tweet_url": f"https://x.com/{config.BANKRBOT_USERNAME}/status/{tweet_id}",
            "detected_at": datetime.now(timezone.utc).isoformat(),
        }

    async def poll(self):
        """Single poll cycle: fetch recent @bankrbot tweets and check for deployments."""
        logger.info("Polling @bankrbot for new tweets...")

        tweets = await self._get_bankrbot_tweets()

        if not tweets:
            logger.info("No tweets returned")
            return

        logger.info(f"Fetched {len(tweets)} tweets, checking for deployments...")
        for tweet in tweets:
            tweet_id = tweet.get("id_str", "")
            if not tweet_id or tweet_id in self._seen_tweet_ids:
                continue
            self._seen_tweet_ids.add(tweet_id)

            deployment = self._parse_deployment_tweet(tweet)
            if not deployment:
                continue

            original = await self._trace_original_author(tweet)
            deployment["original_author_username"] = original.get("username")
            deployment["original_author_user_id"] = original.get("user_id")
            deployment["original_tweet_text"] = original.get("tweet_text")
            deployment["original_tweet_url"] = original.get("tweet_url")

            logger.info(
                f"Deployment detected: ${deployment.get('ticker')} "
                f"original author: @{deployment.get('original_author_username')} "
                f"CA: {deployment.get('contract_address')}"
            )

            await self.on_deployment_detected(deployment)

    async def run(self):
        """Continuously poll for new deployments."""
        logger.info("Twitter monitor started (SocialData API)")
        while True:
            try:
                await self.poll()
            except Exception as e:
                logger.error(f"Twitter monitor error: {e}")
            await asyncio.sleep(config.TWITTER_POLL_INTERVAL_SECONDS)
