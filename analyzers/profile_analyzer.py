"""
Profile Influence Analyzer.

Fetches a Twitter user's profile and computes an influence score (0-100) based on:
- Follower count
- Whether key accounts follow them
- Bio keywords (AI, developer, crypto, company affiliations)
- Verification status

Only deployments that score above the configured threshold trigger an alert.
"""

import logging
from dataclasses import dataclass, field

import tweepy

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


class ProfileAnalyzer:
    def __init__(self):
        self.client = tweepy.Client(bearer_token=config.TWITTER_BEARER_TOKEN)
        # Cache to avoid re-checking the same user
        self._cache = {}

    def analyze(self, username: str) -> ProfileReport:
        """Analyze a Twitter profile and return an influence score report."""
        if not username:
            return ProfileReport(username="unknown", score=0, passes_threshold=False)

        # Check cache
        if username.lower() in self._cache:
            logger.info(f"Using cached profile for @{username}")
            return self._cache[username.lower()]

        report = ProfileReport(username=username)

        # Fetch user profile
        user_data = self._fetch_profile(username)
        if not user_data:
            logger.warning(f"Could not fetch profile for @{username}")
            return report

        report.name = user_data.name or ""
        report.bio = user_data.description or ""
        report.followers_count = user_data.public_metrics.get("followers_count", 0) if user_data.public_metrics else 0
        report.following_count = user_data.public_metrics.get("following_count", 0) if user_data.public_metrics else 0
        report.verified = user_data.verified or False
        report.profile_url = f"https://x.com/{username}"

        # Score: followers
        follower_score = self._score_followers(report.followers_count)
        report.score_breakdown["followers"] = follower_score

        # Score: key accounts that follow this user
        key_follower_score, key_followers = self._score_key_followers(username)
        report.score_breakdown["key_followers"] = key_follower_score
        report.key_followers = key_followers

        # Score: bio keywords
        bio_score, bio_matches = self._score_bio(report.bio)
        report.score_breakdown["bio_keywords"] = bio_score
        report.bio_keyword_matches = bio_matches

        # Score: verified
        verified_score = config.SCORING["verified_bonus"] if report.verified else 0
        report.score_breakdown["verified"] = verified_score

        # Total (capped at 100)
        report.score = min(100, follower_score + key_follower_score + bio_score + verified_score)
        report.passes_threshold = report.score >= config.INFLUENCE_THRESHOLD

        logger.info(
            f"Profile @{username}: score={report.score} "
            f"(followers={follower_score}, key_followers={key_follower_score}, "
            f"bio={bio_score}, verified={verified_score}) "
            f"{'PASS' if report.passes_threshold else 'SKIP'}"
        )

        self._cache[username.lower()] = report
        return report

    def _fetch_profile(self, username: str):
        """Fetch a user's profile from Twitter API."""
        try:
            resp = self.client.get_user(
                username=username,
                user_fields=["description", "public_metrics", "verified", "created_at"],
            )
            return resp.data if resp else None
        except tweepy.TooManyRequests:
            logger.warning("Rate limited while fetching profile")
            return None
        except Exception as e:
            logger.error(f"Error fetching profile for @{username}: {e}")
            return None

    def _score_followers(self, count: int) -> int:
        """Score based on follower count tiers."""
        for threshold, points in sorted(config.SCORING["followers"].items(), reverse=True):
            if count >= threshold:
                return points
        return 0

    def _score_key_followers(self, username: str) -> tuple:
        """
        Check how many key accounts follow this user.
        Uses friendship lookup to check follow relationships.
        Returns (score, list_of_key_followers).
        """
        key_followers = []
        total_points = 0

        for key_account in config.KEY_ACCOUNTS:
            if total_points >= config.SCORING["key_follower_cap"]:
                break

            try:
                # Check if key_account follows username
                # Twitter API v2: check relationship
                relationship = self._check_follows(key_account, username)
                if relationship:
                    key_followers.append(key_account)
                    total_points += config.SCORING["key_follower_points"]
                    logger.info(f"  @{key_account} follows @{username}")
            except tweepy.TooManyRequests:
                logger.warning("Rate limited during key follower check, stopping early")
                break
            except Exception as e:
                logger.debug(f"Error checking if @{key_account} follows @{username}: {e}")
                continue

        return min(total_points, config.SCORING["key_follower_cap"]), key_followers

    def _check_follows(self, source_username: str, target_username: str) -> bool:
        """Check if source_username follows target_username."""
        try:
            source = self.client.get_user(username=source_username)
            target = self.client.get_user(username=target_username)
            if not source or not source.data or not target or not target.data:
                return False

            # Get followers of target and check if source is among them
            # More efficient: get following of source and check if target is in it
            # But with v2 free tier limits, we do a targeted check
            followers = self.client.get_users_followers(
                target.data.id,
                max_results=1000,
                user_fields=["username"],
            )
            if followers and followers.data:
                for follower in followers.data:
                    if follower.username.lower() == source_username.lower():
                        return True
        except Exception:
            pass
        return False

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
