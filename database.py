"""
SQLite database for storing deployments, profile analyses, and alert history.
"""

import aiosqlite
import json
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

DB_PATH = "bankrbot_alerts.db"


async def init_db():
    """Create tables if they don't exist."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS deployments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contract_address TEXT,
                ticker TEXT,
                token_name TEXT,
                source TEXT,
                triggering_username TEXT,
                tweet_text TEXT,
                tweet_url TEXT,
                original_tweet_text TEXT,
                original_author_username TEXT,
                original_tweet_url TEXT,
                tx_hash TEXT,
                total_supply REAL,
                basescan_url TEXT,
                detected_at TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT,
                name TEXT,
                bio TEXT,
                followers_count INTEGER,
                following_count INTEGER,
                verified INTEGER DEFAULT 0,
                score INTEGER,
                score_breakdown TEXT,
                key_followers TEXT,
                bio_keyword_matches TEXT,
                passes_threshold INTEGER DEFAULT 0,
                analyzed_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                deployment_id INTEGER,
                profile_id INTEGER,
                alerted INTEGER DEFAULT 0,
                score INTEGER,
                reason TEXT,
                sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (deployment_id) REFERENCES deployments(id),
                FOREIGN KEY (profile_id) REFERENCES profiles(id)
            )
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_deployments_ca ON deployments(contract_address)
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username)
        """)
        await db.commit()
        logger.info("Database initialized")


async def save_deployment(deployment: dict) -> int:
    """Save a deployment record. Returns the row ID."""
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """INSERT INTO deployments
               (contract_address, ticker, token_name, source, triggering_username,
                tweet_text, tweet_url, original_tweet_text, original_author_username,
                original_tweet_url, tx_hash, total_supply, basescan_url, detected_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                deployment.get("contract_address"),
                deployment.get("ticker"),
                deployment.get("token_name"),
                deployment.get("source"),
                deployment.get("triggering_username"),
                deployment.get("tweet_text"),
                deployment.get("bankrbot_tweet_url"),
                deployment.get("original_tweet_text"),
                deployment.get("original_author_username"),
                deployment.get("original_tweet_url"),
                deployment.get("tx_hash"),
                deployment.get("total_supply"),
                deployment.get("basescan_url"),
                deployment.get("detected_at"),
            ),
        )
        await db.commit()
        return cursor.lastrowid


async def save_profile(report) -> int:
    """Save a profile analysis. Returns the row ID."""
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """INSERT INTO profiles
               (username, name, bio, followers_count, following_count, verified,
                score, score_breakdown, key_followers, bio_keyword_matches, passes_threshold)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                report.username,
                report.name,
                report.bio,
                report.followers_count,
                report.following_count,
                1 if report.verified else 0,
                report.score,
                json.dumps(report.score_breakdown),
                json.dumps(report.key_followers),
                json.dumps(report.bio_keyword_matches),
                1 if report.passes_threshold else 0,
            ),
        )
        await db.commit()
        return cursor.lastrowid


async def save_alert(deployment_id: int, profile_id: int, alerted: bool, score: int, reason: str):
    """Save an alert record."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO alerts (deployment_id, profile_id, alerted, score, reason)
               VALUES (?, ?, ?, ?, ?)""",
            (deployment_id, profile_id, 1 if alerted else 0, score, reason),
        )
        await db.commit()


async def get_deployments(limit=50, offset=0, alerted_only=False):
    """Get deployments with their profile and alert info."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        query = """
            SELECT d.*, p.score, p.key_followers, p.bio_keyword_matches,
                   p.followers_count as profile_followers, p.bio as profile_bio,
                   p.name as profile_name, p.score_breakdown,
                   a.alerted, a.reason
            FROM deployments d
            LEFT JOIN alerts a ON a.deployment_id = d.id
            LEFT JOIN profiles p ON a.profile_id = p.id
        """
        if alerted_only:
            query += " WHERE a.alerted = 1"
        query += " ORDER BY d.id DESC LIMIT ? OFFSET ?"

        cursor = await db.execute(query, (limit, offset))
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_stats():
    """Get dashboard statistics."""
    async with aiosqlite.connect(DB_PATH) as db:
        total = await db.execute("SELECT COUNT(*) FROM deployments")
        total_count = (await total.fetchone())[0]

        alerted = await db.execute("SELECT COUNT(*) FROM alerts WHERE alerted = 1")
        alerted_count = (await alerted.fetchone())[0]

        skipped = await db.execute("SELECT COUNT(*) FROM alerts WHERE alerted = 0")
        skipped_count = (await skipped.fetchone())[0]

        avg_score = await db.execute("SELECT AVG(score) FROM profiles")
        avg = (await avg_score.fetchone())[0] or 0

        return {
            "total_deployments": total_count,
            "alerts_sent": alerted_count,
            "skipped": skipped_count,
            "avg_influence_score": round(avg, 1),
        }


async def get_profile(username: str):
    """Get the most recent profile analysis for a username."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM profiles WHERE username = ? ORDER BY id DESC LIMIT 1",
            (username,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None
