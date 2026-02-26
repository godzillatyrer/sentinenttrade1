"""
BankrBot Alert System — Main Orchestrator.

Runs both the Twitter monitor and Base chain monitor concurrently.
When a deployment is detected from either source:
  1. Identifies who triggered it
  2. Analyzes their Twitter profile for influence (followers, key followers, bio)
  3. If the influence score passes the threshold, sends a Telegram alert

Usage:
  1. Copy .env.example to .env and fill in your API keys
  2. pip install -r requirements.txt
  3. python main.py
"""

import asyncio
import logging
import sys

import config
from monitors.twitter_monitor import TwitterMonitor
from monitors.chain_monitor import ChainMonitor
from analyzers.profile_analyzer import ProfileAnalyzer
from alerts.telegram_bot import TelegramAlerter

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("bankrbot-alerts")

# Shared state to deduplicate across monitors
seen_contracts = set()


async def handle_deployment(deployment: dict, analyzer: ProfileAnalyzer, alerter: TelegramAlerter):
    """
    Central handler called by both Twitter and chain monitors.
    Analyzes the deployer profile and sends alert if influential.
    """
    ca = deployment.get("contract_address")

    # Deduplicate: if we already processed this CA from the other monitor, skip
    if ca and ca in seen_contracts:
        logger.info(f"Already processed CA {ca}, skipping duplicate from {deployment.get('source')}")
        return
    if ca:
        seen_contracts.add(ca)

    # Determine who to analyze
    username = deployment.get("triggering_username") or deployment.get("original_author_username")

    if not username:
        logger.info(f"No triggering username found for deployment, skipping analysis")
        return

    # Analyze profile
    logger.info(f"Analyzing profile: @{username}")
    report = analyzer.analyze(username)

    if report.passes_threshold:
        logger.info(
            f"ALERT: @{username} scored {report.score}/{config.INFLUENCE_THRESHOLD} — sending Telegram alert"
        )
        await alerter.send_alert(deployment, report)
    else:
        logger.info(
            f"SKIP: @{username} scored {report.score}/{config.INFLUENCE_THRESHOLD} — below threshold"
        )


def validate_config():
    """Check that required config values are set."""
    errors = []
    if not config.TWITTER_BEARER_TOKEN:
        errors.append("TWITTER_BEARER_TOKEN is not set")
    if not config.TELEGRAM_BOT_TOKEN:
        errors.append("TELEGRAM_BOT_TOKEN is not set")
    if not config.TELEGRAM_CHAT_ID:
        errors.append("TELEGRAM_CHAT_ID is not set")

    if errors:
        for err in errors:
            logger.error(f"Config error: {err}")
        logger.error("Copy .env.example to .env and fill in your API keys")
        sys.exit(1)

    if not config.BANKRBOT_DEPLOYER_WALLETS:
        logger.warning(
            "No BANKRBOT_DEPLOYER_WALLETS configured — chain monitoring will be disabled. "
            "Add BankrBot's deployer wallet addresses to config.py to enable on-chain monitoring."
        )


async def main():
    validate_config()

    analyzer = ProfileAnalyzer()
    alerter = TelegramAlerter()

    # Send startup notification
    await alerter.send_startup_message()
    logger.info("BankrBot Alert System started")
    logger.info(f"Influence threshold: {config.INFLUENCE_THRESHOLD}/100")
    logger.info(f"Key accounts watchlist: {len(config.KEY_ACCOUNTS)} accounts")

    # Create monitors with shared handler
    async def on_deployment(deployment):
        await handle_deployment(deployment, analyzer, alerter)

    twitter_monitor = TwitterMonitor(on_deployment_detected=on_deployment)
    chain_monitor = ChainMonitor(on_deployment_detected=on_deployment)

    # Run both monitors concurrently
    await asyncio.gather(
        twitter_monitor.run(),
        chain_monitor.run(),
    )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Shutting down...")
