"""
Twitter Monitor for BankrBot.

Polls @bankrbot's recent tweets/replies for token deployment announcements.
Extracts: deployer username, contract address (CA), token ticker, original tweet context.
"""

import re
import logging
import asyncio
from datetime import datetime, timezone

import tweepy

import config

logger = logging.getLogger(__name__)

# Patterns BankrBot uses when announcing deployments
# Adjust these as BankrBot's tweet format changes
CA_PATTERN = re.compile(r"0x[a-fA-F0-9]{40}")
TICKER_PATTERN = re.compile(r"\$([A-Za-z0-9]+)")
DEPLOYED_KEYWORDS = ["deployed", "created", "launched", "live on base", "token is live"]


class TwitterMonitor:
    def __init__(self, on_deployment_detected):
        """
        Args:
            on_deployment_detected: async callback(deployment_info: dict)
        """
        self.client = tweepy.Client(bearer_token=config.TWITTER_BEARER_TOKEN)
        self.on_deployment_detected = on_deployment_detected
        self._seen_tweet_ids = set()
        self._bankrbot_user_id = None

    def _get_bankrbot_user_id(self):
        if self._bankrbot_user_id:
            return self._bankrbot_user_id
        user = self.client.get_user(username=config.BANKRBOT_USERNAME)
        if user and user.data:
            self._bankrbot_user_id = user.data.id
            logger.info(f"Resolved @{config.BANKRBOT_USERNAME} -> ID {self._bankrbot_user_id}")
        return self._bankrbot_user_id

    def _parse_deployment_tweet(self, tweet, includes):
        """Parse a BankrBot tweet to extract deployment info."""
        text = tweet.text.lower()

        # Check if this tweet is actually a deployment announcement
        is_deployment = any(kw in text for kw in DEPLOYED_KEYWORDS)
        if not is_deployment:
            return None

        # Extract contract address
        ca_match = CA_PATTERN.search(tweet.text)
        contract_address = ca_match.group(0) if ca_match else None

        # Extract ticker
        ticker_match = TICKER_PATTERN.search(tweet.text)
        ticker = ticker_match.group(1) if ticker_match else None

        # Find who triggered the deployment (look at the conversation)
        triggering_user = self._find_triggering_user(tweet, includes)

        return {
            "source": "twitter",
            "tweet_id": tweet.id,
            "tweet_text": tweet.text,
            "contract_address": contract_address,
            "ticker": ticker,
            "triggering_username": triggering_user.get("username"),
            "triggering_user_id": triggering_user.get("id"),
            "bankrbot_tweet_url": f"https://x.com/{config.BANKRBOT_USERNAME}/status/{tweet.id}",
            "detected_at": datetime.now(timezone.utc).isoformat(),
        }

    def _find_triggering_user(self, tweet, includes):
        """
        Determine who triggered the deployment.
        BankrBot replies to the person who tagged it, so we look at:
        1. The tweet BankrBot is replying to (in_reply_to_user_id)
        2. Mentions in the conversation
        """
        # If BankrBot is replying to someone, that's likely the trigger context
        if tweet.in_reply_to_user_id and tweet.in_reply_to_user_id != self._bankrbot_user_id:
            # Look up this user in includes
            if includes and "users" in includes:
                for user in includes["users"]:
                    if user.id == tweet.in_reply_to_user_id:
                        return {"username": user.username, "id": user.id}
            return {"username": None, "id": tweet.in_reply_to_user_id}

        # Check mentions in the tweet (excluding bankrbot itself)
        if hasattr(tweet, "entities") and tweet.entities and "mentions" in tweet.entities:
            for mention in tweet.entities["mentions"]:
                if mention["username"].lower() != config.BANKRBOT_USERNAME:
                    return {"username": mention["username"], "id": mention.get("id")}

        return {"username": None, "id": None}

    def _fetch_conversation_context(self, tweet):
        """Fetch the original tweet in the conversation for context."""
        if not tweet.conversation_id or tweet.conversation_id == tweet.id:
            return None

        try:
            conv_tweet = self.client.get_tweet(
                tweet.conversation_id,
                tweet_fields=["author_id", "text", "created_at"],
                user_fields=["username", "name"],
                expansions=["author_id"],
            )
            if conv_tweet and conv_tweet.data:
                author = None
                if conv_tweet.includes and "users" in conv_tweet.includes:
                    author = conv_tweet.includes["users"][0]
                return {
                    "original_tweet_text": conv_tweet.data.text,
                    "original_author_username": author.username if author else None,
                    "original_tweet_url": f"https://x.com/{author.username if author else 'i'}/status/{conv_tweet.data.id}",
                }
        except Exception as e:
            logger.warning(f"Failed to fetch conversation context: {e}")

        return None

    async def poll(self):
        """Single poll cycle: fetch recent @bankrbot tweets and check for deployments."""
        user_id = self._get_bankrbot_user_id()
        if not user_id:
            logger.error("Could not resolve BankrBot user ID")
            return

        try:
            tweets = self.client.get_users_tweets(
                user_id,
                max_results=10,
                tweet_fields=["conversation_id", "in_reply_to_user_id", "created_at", "entities"],
                user_fields=["username", "name"],
                expansions=["in_reply_to_user_id", "entities.mentions.username"],
            )
        except tweepy.TooManyRequests:
            logger.warning("Twitter rate limit hit, backing off")
            await asyncio.sleep(60)
            return
        except Exception as e:
            logger.error(f"Twitter API error: {e}")
            return

        if not tweets or not tweets.data:
            return

        includes = tweets.includes if tweets.includes else {}

        for tweet in tweets.data:
            if tweet.id in self._seen_tweet_ids:
                continue
            self._seen_tweet_ids.add(tweet.id)

            deployment = self._parse_deployment_tweet(tweet, includes)
            if not deployment:
                continue

            # Enrich with conversation context
            context = self._fetch_conversation_context(tweet)
            if context:
                deployment.update(context)

            logger.info(
                f"Deployment detected via Twitter: ${deployment.get('ticker')} "
                f"by @{deployment.get('triggering_username')} "
                f"CA: {deployment.get('contract_address')}"
            )

            await self.on_deployment_detected(deployment)

    async def run(self):
        """Continuously poll for new deployments."""
        logger.info("Twitter monitor started")
        while True:
            try:
                await self.poll()
            except Exception as e:
                logger.error(f"Twitter monitor error: {e}")
            await asyncio.sleep(config.TWITTER_POLL_INTERVAL_SECONDS)
