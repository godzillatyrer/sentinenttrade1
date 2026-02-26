"""
Telegram Alert Bot.

Sends formatted deployment alerts to a Telegram chat when a high-influence
BankrBot deployment is detected.
"""

import logging
import asyncio

from telegram import Bot
from telegram.constants import ParseMode

import config

logger = logging.getLogger(__name__)


class TelegramAlerter:
    def __init__(self):
        self.bot = Bot(token=config.TELEGRAM_BOT_TOKEN)
        self.chat_id = config.TELEGRAM_CHAT_ID

    async def send_alert(self, deployment: dict, profile_report):
        """Send a formatted deployment alert to Telegram."""
        message = self._format_message(deployment, profile_report)
        try:
            await self.bot.send_message(
                chat_id=self.chat_id,
                text=message,
                parse_mode=ParseMode.HTML,
                disable_web_page_preview=False,
            )
            logger.info(f"Alert sent for ${deployment.get('ticker', '???')}")
        except Exception as e:
            logger.error(f"Failed to send Telegram alert: {e}")
            # Retry once after a short delay
            try:
                await asyncio.sleep(2)
                await self.bot.send_message(
                    chat_id=self.chat_id,
                    text=message,
                    parse_mode=ParseMode.HTML,
                    disable_web_page_preview=False,
                )
            except Exception as retry_err:
                logger.error(f"Telegram retry also failed: {retry_err}")

    def _format_message(self, deployment: dict, profile_report) -> str:
        """Format the alert message."""
        ticker = deployment.get("ticker", "???")
        ca = deployment.get("contract_address", "N/A")
        source = deployment.get("source", "unknown")
        original_author = deployment.get("original_author_username") or profile_report.username
        token_name = deployment.get("token_name", "")

        lines = [
            f"🚨 <b>BANKRBOT DEPLOYMENT ALERT</b> 🚨",
            "",
            f"<b>Token:</b> ${ticker}" + (f" ({token_name})" if token_name else ""),
            f"<b>CA:</b> <code>{ca}</code>",
            f"<b>Source:</b> {source.upper()}",
            "",
            f"━━━ Original Author ━━━",
            f"<b>User:</b> @{original_author}",
            f"<b>Name:</b> {profile_report.name}",
            f"<b>Bio:</b> {profile_report.bio[:200]}{'...' if len(profile_report.bio) > 200 else ''}",
            f"<b>Followers:</b> {profile_report.followers_count:,}",
            f"<b>Influence Score:</b> {profile_report.score}/100",
        ]

        # AI profile detection
        if getattr(profile_report, 'is_automated', False):
            lines.append(f"⚠️ <b>AI/Bot Profile Detected</b>")
            parent = getattr(profile_report, 'parent_username', '')
            if parent:
                lines.append(f"<b>Real Person Behind:</b> @{parent}")
                lines.append(f"<b>Parent Score:</b> {getattr(profile_report, 'parent_score', 0)}/100")

        # Score breakdown
        if profile_report.score_breakdown:
            breakdown_parts = [
                f"{k}: {v}" for k, v in profile_report.score_breakdown.items() if v > 0
            ]
            if breakdown_parts:
                lines.append(f"<b>Breakdown:</b> {' | '.join(breakdown_parts)}")

        # Key followers
        if profile_report.key_followers:
            followers_str = ", ".join(f"@{f}" for f in profile_report.key_followers)
            lines.append(f"<b>Key Followers:</b> {followers_str}")

        # Bio keyword matches
        if profile_report.bio_keyword_matches:
            lines.append(f"<b>Bio Tags:</b> {', '.join(profile_report.bio_keyword_matches)}")

        lines.append("")
        lines.append("━━━ Links ━━━")

        # Links
        if ca and ca != "N/A":
            lines.append(f"📊 <a href='https://basescan.org/address/{ca}'>Basescan</a>")
            lines.append(f"📈 <a href='https://dexscreener.com/base/{ca}'>DexScreener</a>")
            lines.append(f"🦄 <a href='https://app.uniswap.org/swap?chain=base&outputCurrency={ca}'>Uniswap</a>")

        if deployment.get("bankrbot_tweet_url"):
            lines.append(f"🐦 <a href='{deployment['bankrbot_tweet_url']}'>BankrBot Tweet</a>")

        if deployment.get("original_tweet_url"):
            lines.append(f"🔗 <a href='{deployment['original_tweet_url']}'>Original Tweet</a>")

        lines.append(f"👤 <a href='https://x.com/{original_author}'>Original Author Profile</a>")

        # On-chain details if available
        if deployment.get("basescan_tx_url"):
            lines.append(f"🔗 <a href='{deployment['basescan_tx_url']}'>Deploy TX</a>")

        if deployment.get("total_supply"):
            lines.append(f"\n<b>Total Supply:</b> {deployment['total_supply']:,.0f}")

        return "\n".join(lines)

    async def send_startup_message(self):
        """Send a message when the bot starts up."""
        try:
            await self.bot.send_message(
                chat_id=self.chat_id,
                text=(
                    "✅ <b>BankrBot Alert System Online</b>\n\n"
                    f"Influence threshold: {config.INFLUENCE_THRESHOLD}/100\n"
                    f"Watching: @{config.BANKRBOT_USERNAME}\n"
                    f"Chain: Base (wallets: {len(config.BANKRBOT_DEPLOYER_WALLETS)})\n"
                    f"Twitter poll: every {config.TWITTER_POLL_INTERVAL_SECONDS}s\n"
                    f"Chain poll: every {config.CHAIN_POLL_INTERVAL_SECONDS}s"
                ),
                parse_mode=ParseMode.HTML,
            )
        except Exception as e:
            logger.error(f"Failed to send startup message: {e}")
