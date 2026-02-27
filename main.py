"""
BankrBot Alert System — Main Orchestrator.

Runs the Twitter monitor, Base chain monitor, and web dashboard concurrently.
When a deployment is detected from either source:
  1. Saves it to the database
  2. Traces back to the original tweet author (not the person who tagged bankrbot)
  3. If the author looks like an AI/bot, finds the real person behind it
  4. Analyzes the profile for influence — sends Telegram alert if above threshold
  5. All data is viewable on the web dashboard at http://localhost:8000

Usage:
  1. Copy .env.example to .env and fill in your API keys
  2. pip install -r requirements.txt
  3. python main.py

The dashboard will be available at http://localhost:8000
"""

import asyncio
import logging
import os
import sys
import threading

# Configure logging BEFORE any third-party imports so crashes are visible
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("bankrbot-alerts")
logger.info("Starting BankrBot Alert System...")

try:
    import uvicorn
    import config
    import database
    from monitors.twitter_monitor import TwitterMonitor
    from monitors.chain_monitor import ChainMonitor
    from analyzers.profile_analyzer import ProfileAnalyzer
    from alerts.telegram_bot import TelegramAlerter
    from web_server import app
except Exception as e:
    logger.error(f"Failed to import modules: {e}")
    sys.exit(1)

# Shared state to deduplicate across monitors
seen_contracts = set()


async def handle_deployment(deployment: dict, analyzer: ProfileAnalyzer, alerter: TelegramAlerter):
    """
    Central handler called by both Twitter and chain monitors.
    Saves to DB, analyzes deployer profile, and sends alert if influential.
    """
    ca = deployment.get("contract_address")

    # Deduplicate: if we already processed this CA from the other monitor, skip
    if ca and ca in seen_contracts:
        logger.info(f"Already processed CA {ca}, skipping duplicate from {deployment.get('source')}")
        return
    if ca:
        seen_contracts.add(ca)

    # Save deployment to database
    deployment_id = await database.save_deployment(deployment)
    logger.info(f"Saved deployment #{deployment_id} to database")

    # Determine who to analyze — we want the ORIGINAL tweet author (the person
    # whose content inspired the coin), NOT the person who tagged bankrbot
    username = deployment.get("original_author_username")

    if not username:
        logger.info("No original author found for deployment, skipping analysis")
        await database.save_alert(deployment_id, 0, False, 0, "No original author found")
        return

    # Analyze profile (handles AI/bot detection and parent account tracing)
    logger.info(f"Analyzing original author: @{username}")
    report = await analyzer.analyze(username)

    # Save profile to database
    profile_id = await database.save_profile(report)

    extra = ""
    if report.is_automated and report.parent_username:
        extra = f" (AI profile, real person: @{report.parent_username})"

    if report.passes_threshold:
        logger.info(
            f"ALERT: @{username} scored {report.score}/{config.INFLUENCE_THRESHOLD}{extra} — sending Telegram alert"
        )
        await database.save_alert(deployment_id, profile_id, True, report.score, "Passes influence threshold")
        await alerter.send_alert(deployment, report)
    else:
        logger.info(
            f"SKIP: @{username} scored {report.score}/{config.INFLUENCE_THRESHOLD}{extra} — below threshold"
        )
        await database.save_alert(deployment_id, profile_id, False, report.score, "Below influence threshold")


def validate_config():
    """Check that required config values are set."""
    errors = []
    if not config.TELEGRAM_BOT_TOKEN:
        errors.append("TELEGRAM_BOT_TOKEN is not set")
    if not config.TELEGRAM_CHAT_ID:
        errors.append("TELEGRAM_CHAT_ID is not set")
    if not config.SOCIALDATA_API_KEY:
        errors.append("SOCIALDATA_API_KEY is not set (sign up at socialdata.tools)")

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


def start_web_server():
    """Run the FastAPI web server in a separate thread."""
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")


async def main():
    validate_config()

    # Initialize database
    await database.init_db()

    analyzer = ProfileAnalyzer()
    alerter = TelegramAlerter()

    # Start web dashboard in background thread
    port = int(os.getenv("PORT", 8000))
    web_thread = threading.Thread(target=start_web_server, daemon=True)
    web_thread.start()
    logger.info(f"Web dashboard running on port {port}")

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
