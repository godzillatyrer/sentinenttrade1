"""
Profile Influence Analyzer.

Fetches a Twitter user's profile via twikit (free, no API key) and computes
an influence score (0-100) based on:
- Follower count
- Bio keywords (AI, developer, crypto, company affiliations)
- Verification status
- Account engagement signals

Also detects automated/AI profiles and traces back to the real person behind them.
For example: an influencer creates an AI agent profile with 0 followers, someone
launches a coin from that AI's tweet — the analyzer finds the real influencer and
scores them instead.
"""

import re
import logging
from dataclasses import dataclass, field

from twikit.guest import GuestClient

import config

logger = logging.getLogger(__name__)


@dataclass
class ProfileReport:
    username: str
    name: str = ""
    bio: str = ""
    followers_count: int = 0
    following_count: int = 0
    verified: bool = False
    profile_url: str = ""
    score: int = 0
    score_breakdown: dict = field(default_factory=dict)
    key_followers: list = field(default_factory=list)
    bio_keyword_matches: list = field(default_factory=list)
    passes_threshold: bool = False
    is_automated: bool = False
    parent_username: str = ""
    parent_score: int = 0


class ProfileAnalyzer:
    def __init__(self):
        self.client = GuestClient()
        self._activated = False
        self._cache = {}

    async def _ensure_activated(self):
        """Activate the guest client."""
        if not self._activated:
            try:
                await self.client.activate()
                self._activated = True
            except Exception as e:
                logger.error(f"Failed to activate GuestClient: {e}")
                raise

    async def analyze(self, username: str) -> ProfileReport:
        """
        Analyze a Twitter profile and return an influence score report.

        If the profile looks like an AI/bot account:
        1. Check bio for the real person behind it (@mentions, "by @someone")
        2. Analyze the real person and score them instead
        3. Report includes both the AI profile and the parent account info
        """
        if not username:
            return ProfileReport(username="unknown", score=0, passes_threshold=False)

        # Check cache
        if username.lower() in self._cache:
            logger.info(f"Using cached profile for @{username}")
            return self._cache[username.lower()]

        await self._ensure_activated()

        report = ProfileReport(username=username)

        # Fetch user profile
        user_data = await self._fetch_profile(username)
        if not user_data:
            logger.warning(f"Could not fetch profile for @{username}")
            return report

        report.name = getattr(user_data, 'name', '') or ''
        report.bio = getattr(user_data, 'description', '') or ''
        report.followers_count = getattr(user_data, 'followers_count', 0) or 0
        report.following_count = getattr(user_data, 'following_count', 0) or 0
        report.verified = getattr(user_data, 'is_blue_verified', False) or False
        report.profile_url = f"https://x.com/{username}"

        # Check if this looks like an automated/AI profile
        if self._is_likely_automated(report):
            report.is_automated = True
            logger.info(f"@{username} looks automated/AI — searching for real person behind it")

            parent_username = self._find_parent_account(report.bio)

            # Also check pinned tweets and recent tweets for parent clues
            if not parent_username:
                parent_username = await self._find_parent_from_tweets(user_data)

            if parent_username:
                report.parent_username = parent_username
                logger.info(f"Found parent account: @{parent_username} behind @{username}")

                # Analyze the real person behind the AI profile
                parent_report = await self._analyze_profile_score(parent_username)
                if parent_report:
                    report.score = parent_report.score
                    report.score_breakdown = parent_report.score_breakdown
                    report.bio_keyword_matches = parent_report.bio_keyword_matches
                    report.parent_score = parent_report.score
                    report.passes_threshold = parent_report.passes_threshold

                    logger.info(
                        f"Parent @{parent_username}: score={parent_report.score} "
                        f"(behind AI @{username}) "
                        f"{'PASS' if parent_report.passes_threshold else 'SKIP'}"
                    )

                    self._cache[username.lower()] = report
                    return report
            else:
                logger.info(f"Could not find parent account for AI profile @{username}")

        # Score the profile directly (either it's a real person, or we couldn't
        # find the parent of an AI account)
        scored = await self._analyze_profile_score(username, user_data=user_data, report=report)
        self._cache[username.lower()] = scored
        return scored

    async def _analyze_profile_score(self, username: str, user_data=None, report=None) -> ProfileReport:
        """Score a profile based on followers, bio, and verification."""
        if report is None:
            report = ProfileReport(username=username)

        if user_data is None:
            user_data = await self._fetch_profile(username)
            if not user_data:
                return report

            report.name = getattr(user_data, 'name', '') or ''
            report.bio = getattr(user_data, 'description', '') or ''
            report.followers_count = getattr(user_data, 'followers_count', 0) or 0
            report.following_count = getattr(user_data, 'following_count', 0) or 0
            report.verified = getattr(user_data, 'is_blue_verified', False) or False
            report.profile_url = f"https://x.com/{username}"

        # Score: followers
        follower_score = self._score_followers(report.followers_count)
        report.score_breakdown["followers"] = follower_score

        # Score: bio keywords
        bio_score, bio_matches = self._score_bio(report.bio)
        report.score_breakdown["bio_keywords"] = bio_score
        report.bio_keyword_matches = bio_matches

        # Score: verified
        verified_score = config.SCORING["verified_bonus"] if report.verified else 0
        report.score_breakdown["verified"] = verified_score

        # Score: engagement signals (statuses count, listed count)
        engagement_score = self._score_engagement(user_data)
        report.score_breakdown["engagement"] = engagement_score

        # Total (capped at 100)
        report.score = min(100, follower_score + bio_score + verified_score + engagement_score)
        report.passes_threshold = report.score >= config.INFLUENCE_THRESHOLD

        logger.info(
            f"Profile @{username}: score={report.score} "
            f"(followers={follower_score}, bio={bio_score}, "
            f"verified={verified_score}, engagement={engagement_score}) "
            f"{'PASS' if report.passes_threshold else 'SKIP'}"
        )

        return report

    async def _fetch_profile(self, username: str):
        """Fetch a user's profile via twikit GuestClient."""
        try:
            await self._ensure_activated()
            user = await self.client.get_user_by_screen_name(username)
            return user
        except Exception as e:
            error_str = str(e).lower()
            if 'rate' in error_str or '429' in error_str:
                logger.warning(f"Rate limited while fetching @{username}, re-activating")
                self._activated = False
            else:
                logger.error(f"Error fetching profile for @{username}: {e}")
            return None

    def _is_likely_automated(self, report: ProfileReport) -> bool:
        """
        Detect if a profile is likely an AI/bot account.

        Signals:
        - Low followers AND bio contains AI/bot keywords
        - Account name contains AI/bot indicators
        """
        indicators = config.AI_PROFILE_INDICATORS
        bio_lower = report.bio.lower()
        name_lower = report.name.lower()

        # Check bio for AI keywords
        bio_has_ai = any(kw in bio_lower for kw in indicators["bio_keywords"])

        # Check name for AI keywords
        name_has_ai = any(kw in name_lower for kw in indicators["name_keywords"])

        # Low followers + AI signals = likely automated
        low_followers = report.followers_count <= indicators["max_followers"]

        if low_followers and (bio_has_ai or name_has_ai):
            return True

        # Very strong signals in bio even with moderate followers
        strong_signals = ["ai agent", "autonomous agent", "ai persona", "digital being"]
        if any(s in bio_lower for s in strong_signals):
            return True

        return False

    def _find_parent_account(self, bio: str) -> str | None:
        """
        Search bio text for references to a parent/creator account.

        Looks for patterns like:
        - "by @realPerson"
        - "created by @founder"
        - "@someone's AI"
        - Direct @mentions in bio
        """
        if not bio:
            return None

        indicators = config.AI_PROFILE_INDICATORS

        # Try explicit "by @username" patterns first
        for pattern in indicators["parent_patterns"]:
            match = re.search(pattern, bio, re.IGNORECASE)
            if match:
                parent = match.group(1)
                # Filter out common non-person handles
                if parent.lower() not in {'bankrbot', 'twitter', 'x', config.BANKRBOT_USERNAME}:
                    return parent

        # Fallback: find any @mention in bio that isn't bankrbot
        mention_pattern = r'@(\w+)'
        mentions = re.findall(mention_pattern, bio)
        for mention in mentions:
            if mention.lower() not in {'bankrbot', 'twitter', 'x', config.BANKRBOT_USERNAME}:
                return mention

        return None

    async def _find_parent_from_tweets(self, user_data) -> str | None:
        """
        Check the user's pinned tweet and recent tweets for parent account clues.

        AI accounts often:
        - Pin a tweet mentioning their creator
        - Regularly mention/reply to the parent account
        """
        try:
            # Check pinned tweets
            pinned_ids = getattr(user_data, 'pinned_tweet_ids', None)
            if pinned_ids:
                for pin_id in pinned_ids[:2]:  # check up to 2 pinned tweets
                    try:
                        pinned = await self.client.get_tweet_by_id(str(pin_id))
                        if pinned:
                            text = getattr(pinned, 'text', '') or getattr(pinned, 'full_text', '') or ''
                            parent = self._find_parent_account(text)
                            if parent:
                                return parent
                    except Exception:
                        continue

            # Check recent tweets for frequently mentioned accounts
            user_id = getattr(user_data, 'id', None)
            if user_id:
                try:
                    tweets = await self.client.get_user_tweets(str(user_id), 'Tweets', count=10)
                    if tweets:
                        mention_counts = {}
                        screen_name = getattr(user_data, 'screen_name', '').lower()
                        for tweet in tweets:
                            text = getattr(tweet, 'text', '') or getattr(tweet, 'full_text', '') or ''
                            mentions = re.findall(r'@(\w+)', text)
                            for m in mentions:
                                m_lower = m.lower()
                                if m_lower not in {screen_name, 'bankrbot', config.BANKRBOT_USERNAME}:
                                    mention_counts[m] = mention_counts.get(m, 0) + 1

                        # If one account is mentioned in 3+ of last 10 tweets,
                        # it's likely the parent/controller
                        if mention_counts:
                            top = max(mention_counts, key=mention_counts.get)
                            if mention_counts[top] >= 3:
                                return top
                except Exception as e:
                    logger.debug(f"Error checking recent tweets for parent: {e}")

        except Exception as e:
            logger.debug(f"Error in parent tweet search: {e}")

        return None

    def _score_followers(self, count: int) -> int:
        """Score based on follower count tiers."""
        for threshold, points in sorted(config.SCORING["followers"].items(), reverse=True):
            if count >= threshold:
                return points
        return 0

    def _score_engagement(self, user_data) -> int:
        """
        Score based on engagement signals.
        Higher listed_count and statuses_count indicate an active, notable account.
        """
        score = 0
        listed = getattr(user_data, 'listed_count', 0) or 0
        statuses = getattr(user_data, 'statuses_count', 0) or 0

        # Listed count (other people adding them to curated lists = endorsement)
        if listed >= 1000:
            score += 10
        elif listed >= 500:
            score += 7
        elif listed >= 100:
            score += 5
        elif listed >= 20:
            score += 2

        # Active account with real tweet history
        if statuses >= 10000:
            score += 5
        elif statuses >= 1000:
            score += 3
        elif statuses >= 100:
            score += 1

        return min(score, 15)  # cap engagement score at 15

    def _score_bio(self, bio: str) -> tuple:
        """Score based on keyword matches in the bio."""
        if not bio:
            return 0, []

        bio_lower = bio.lower()
        matches = []
        total_points = 0

        for keyword, points in config.SCORING["bio_keywords"].items():
            if total_points >= config.SCORING["bio_keyword_cap"]:
                break
            if keyword in bio_lower:
                matches.append(keyword)
                total_points += points

        return min(total_points, config.SCORING["bio_keyword_cap"]), matches
