"""
Configuration for BankrBot Alert System.

Defines key influential accounts, scoring weights, and filter criteria.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# --- API Keys ---
# Twitter credentials (optional — only needed if GuestClient gets rate-limited)
TWITTER_USERNAME = os.getenv("TWITTER_USERNAME", "")
TWITTER_EMAIL = os.getenv("TWITTER_EMAIL", "")
TWITTER_PASSWORD = os.getenv("TWITTER_PASSWORD", "")
TWITTER_COOKIES_FILE = os.getenv("TWITTER_COOKIES_FILE", "twitter_cookies.json")

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
BASE_RPC_URL = os.getenv("BASE_RPC_URL", "https://mainnet.base.org")
BASESCAN_API_KEY = os.getenv("BASESCAN_API_KEY", "")
INFLUENCE_THRESHOLD = int(os.getenv("INFLUENCE_THRESHOLD", "40"))

# --- BankrBot ---
BANKRBOT_USERNAME = "bankrbot"

# Known BankrBot deployer wallets on Base (add more as discovered)
# You can find these by checking BankrBot's recent deployment txns on Basescan
BANKRBOT_DEPLOYER_WALLETS = [
    # Add BankrBot's deployer wallet address(es) here
    # "0x..."
]

# --- Key Influential Accounts ---
# These are the accounts we check if the deployer is followed by.
# Format: Twitter username (without @)
KEY_ACCOUNTS = [
    # Tech / AI leaders
    "elonmusk",
    "sama",              # Sam Altman - OpenAI CEO
    "pmarca",            # Marc Andreessen
    "ilyasut",           # Ilya Sutskever
    "karpathy",          # Andrej Karpathy
    "DarioAmodei",       # Dario Amodei - Anthropic CEO
    "naval",             # Naval Ravikant

    # Crypto key figures
    "VitalikButerin",
    "cz_binance",        # CZ Binance
    "brian_armstrong",    # Coinbase CEO
    "jessepollak",       # Base lead at Coinbase
    "hasufl",
    "coinbase",          # Coinbase
    "0xMert_",
    "balaborasu",        # Balaji Srinivasan

    # AI x Crypto crossover
    "shawmakesmagic",    # Shaw (ai16z / elizaOS)
    "ai16zdao",          # ai16z dao
    "0xzerebro",
    "truth_terminal",

    # Top crypto VCs / influencers
    "a16z",
    "paradigm",
    "HsakaTrades",
    "CryptoHayes",       # Arthur Hayes
    "inversebrah",
]

# --- Scoring Weights ---
# Used by the profile analyzer to compute an influence score (0-100)
SCORING = {
    # Follower count tiers -> points
    "followers": {
        1_000_000: 25,   # 1M+ followers
        500_000: 20,
        100_000: 15,
        50_000: 10,
        10_000: 5,
        1_000: 2,
    },

    # Points per key account that follows the deployer
    "key_follower_points": 12,

    # Max points from key followers
    "key_follower_cap": 40,

    # Bio keyword matches -> points each
    "bio_keywords": {
        "ai": 5,
        "artificial intelligence": 5,
        "machine learning": 5,
        "ml engineer": 5,
        "deep learning": 5,
        "llm": 5,
        "gpt": 4,
        "neural": 4,
        "openai": 8,
        "anthropic": 8,
        "google deepmind": 8,
        "deepmind": 7,
        "meta ai": 6,
        "microsoft": 5,
        "google": 5,
        "coinbase": 6,
        "base": 3,
        "developer": 3,
        "engineer": 3,
        "founder": 4,
        "cto": 5,
        "ceo": 4,
        "researcher": 4,
        "phd": 3,
        "crypto": 2,
        "blockchain": 2,
        "defi": 2,
        "solidity": 3,
        "smart contract": 3,
        "vc": 3,
        "investor": 3,
        "a16z": 6,
        "paradigm": 6,
        "polychain": 5,
        "sequoia": 5,
    },

    # Max points from bio keywords
    "bio_keyword_cap": 20,

    # Verified account bonus
    "verified_bonus": 5,
}

# --- AI / Automated Profile Detection ---
# If the original tweet author looks like an AI/bot account, the analyzer
# traces back to find the real person behind it and scores them instead.
AI_PROFILE_INDICATORS = {
    # Bio keywords that suggest automation
    "bio_keywords": ["ai agent", "bot", "automated", "autonomous", "ai persona",
                     "artificial intelligence agent", "virtual", "digital being"],
    # Name keywords
    "name_keywords": ["ai", "bot", "agent", "gpt"],
    # If followers below this AND bio matches AI keywords, treat as automated
    "max_followers": 500,
    # Patterns to find the real person behind an AI account (checked in bio)
    "parent_patterns": [
        r"by\s+@(\w+)",
        r"created\s+by\s+@(\w+)",
        r"built\s+by\s+@(\w+)",
        r"powered\s+by\s+@(\w+)",
        r"from\s+@(\w+)",
        r"made\s+by\s+@(\w+)",
        r"run\s+by\s+@(\w+)",
        r"managed\s+by\s+@(\w+)",
        r"@(\w+)['\u2019]s\s+(?:ai|bot|agent)",
    ],
}

# --- Polling Intervals ---
TWITTER_POLL_INTERVAL_SECONDS = 300  # How often to check @bankrbot tweets (5 min)
CHAIN_POLL_INTERVAL_SECONDS = 5      # How often to check for new blocks on Base
