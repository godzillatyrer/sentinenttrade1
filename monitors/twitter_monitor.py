"""
Twitter Monitor for BankrBot.

Polls @bankrbot's recent tweets for token deployment announcements.
Uses twikit's authenticated Client (requires a Twitter/X account login).

When a deployment is detected, traces back to the ORIGINAL tweet author —
the person whose content inspired the coin, not the random person who tagged bankrbot.
"""

import re
import logging
import asyncio
from datetime import datetime, timezone

from twikit import Client

import config

logger = logging.getLogger(__name__)

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
        self.client = Client('en-US')
        self.on_deployment_detected = on_deployment_detected
        self._seen_tweet_ids = set()
        self._bankrbot_user_id = None
        self._logged_in = False

    async def _ensure_logged_in(self):
        """Log in to Twitter/X using credentials or saved cookies."""
        if self._logged_in:
            return

        # Try loading saved cookies first
        try:
            self.client.load_cookies(config.TWITTER_COOKIES_FILE)
            self._logged_in = True
            logger.info("Loaded saved Twitter session from cookies")
            return
        except Exception:
            pass  # No saved cookies or expired, do fresh login

        if not config.TWITTER_USERNAME or not config.TWITTER_PASSWORD:
            raise RuntimeError(
                "Twitter credentials required: set TWITTER_USERNAME, TWITTER_EMAIL, "
                "and TWITTER_PASSWORD in your .env file. The free GuestClient no longer "
                "works — Twitter removed the guest activation endpoint."
            )

        logger.info(f"Logging in to Twitter as @{config.TWITTER_USERNAME}...")
        await self.client.login(
            auth_info_1=config.TWITTER_USERNAME,
            auth_info_2=config.TWITTER_EMAIL,
            password=config.TWITTER_PASSWORD,
            cookies_file=config.TWITTER_COOKIES_FILE,
        )
        self._logged_in = True
        logger.info("Twitter login successful, cookies saved")

    async def _get_bankrbot_user_id(self):
        """Resolve @bankrbot's user ID (cached after first lookup)."""
        if self._bankrbot_user_id:
            return self._bankrbot_user_id

        try:
            user = await self.client.get_user_by_screen_name(config.BANKRBOT_USERNAME)
            if user:
                self._bankrbot_user_id = user.id
                logger.info(f"Resolved @{config.BANKRBOT_USERNAME} -> ID {user.id}")
                return user.id
        except Exception as e:
            logger.error(f"Error resolving @{config.BANKRBOT_USERNAME}: {e}")
        return None

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
        max_depth = 5  # prevent infinite loops

        for _ in range(max_depth):
            reply_to_id = getattr(current_tweet, 'in_reply_to', None)
            if not reply_to_id:
                break  # this is the root tweet

            try:
                parent_tweet = await self.client.get_tweet_by_id(str(reply_to_id))
                if not parent_tweet:
                    break
                current_tweet = parent_tweet
            except Exception as e:
                logger.warning(f"Failed to fetch parent tweet {reply_to_id}: {e}")
                break

        # current_tweet is now the root (or as far back as we could trace)
        user = getattr(current_tweet, 'user', None)
        if user:
            screen_name = getattr(user, 'screen_name', None)
            return {
                "username": screen_name,
                "user_id": getattr(user, 'id', None),
                "tweet_id": current_tweet.id,
                "tweet_text": getattr(current_tweet, 'text', '') or getattr(current_tweet, 'full_text', ''),
                "tweet_url": f"https://x.com/{screen_name}/status/{current_tweet.id}" if screen_name else None,
            }

        return {"username": None, "user_id": None, "tweet_id": None, "tweet_text": None, "tweet_url": None}

    def _parse_deployment_tweet(self, tweet):
        """Parse a BankrBot tweet to extract deployment info."""
        tweet_text = getattr(tweet, 'text', '') or getattr(tweet, 'full_text', '') or ''
        text_lower = tweet_text.lower()

        # Check if this tweet is actually a deployment announcement
        is_deployment = any(kw in text_lower for kw in DEPLOYED_KEYWORDS)
        if not is_deployment:
            return None

        # Extract contract address
        ca_match = CA_PATTERN.search(tweet_text)
        contract_address = ca_match.group(0) if ca_match else None

        # Extract ticker
        ticker_match = TICKER_PATTERN.search(tweet_text)
        ticker = ticker_match.group(1) if ticker_match else None

        return {
            "source": "twitter",
            "tweet_id": tweet.id,
            "tweet_text": tweet_text,
            "contract_address": contract_address,
            "ticker": ticker,
            "bankrbot_tweet_url": f"https://x.com/{config.BANKRBOT_USERNAME}/status/{tweet.id}",
            "detected_at": datetime.now(timezone.utc).isoformat(),
        }

    async def poll(self):
        """Single poll cycle: fetch recent @bankrbot tweets and check for deployments."""
        logger.info("Polling @bankrbot for new tweets...")
        await self._ensure_logged_in()

        user_id = await self._get_bankrbot_user_id()
        if not user_id:
            logger.error("Could not resolve BankrBot user ID")
            return

        try:
            tweets = await self.client.get_user_tweets(str(user_id), 'Tweets', count=10)
        except Exception as e:
            error_str = str(e).lower()
            if 'rate' in error_str or '429' in error_str:
                logger.warning("Rate limited, backing off 60s")
                await asyncio.sleep(60)
                return
            if 'unauthorized' in error_str or '401' in error_str or 'forbidden' in error_str:
                logger.warning("Session expired, will re-login on next poll")
                self._logged_in = False
                return
            logger.error(f"Error fetching tweets: {e}")
            self._logged_in = False
            return

        if not tweets:
            logger.info("No tweets returned")
            return

        logger.info(f"Fetched {len(tweets)} tweets, checking for deployments...")
        for tweet in tweets:
            tweet_id = str(tweet.id)
            if tweet_id in self._seen_tweet_ids:
                continue
            self._seen_tweet_ids.add(tweet_id)

            deployment = self._parse_deployment_tweet(tweet)
            if not deployment:
                continue

            # Trace back to the original tweet author (the one whose content
            # inspired the coin — NOT the person who tagged bankrbot)
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
        logger.info("Twitter monitor started (authenticated twikit Client)")
        while True:
            try:
                await self.poll()
            except Exception as e:
                logger.error(f"Twitter monitor error: {e}")
                self._logged_in = False  # re-login on next poll
            await asyncio.sleep(config.TWITTER_POLL_INTERVAL_SECONDS)
