"""
Base Chain Monitor.

Watches BankrBot's deployer wallet(s) on Base for new contract creation transactions.
Provides faster detection than Twitter polling since on-chain events happen first.
"""

import logging
import asyncio
from datetime import datetime, timezone

from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware

import config

logger = logging.getLogger(__name__)


class ChainMonitor:
    def __init__(self, on_deployment_detected):
        """
        Args:
            on_deployment_detected: async callback(deployment_info: dict)
        """
        self.w3 = Web3(Web3.HTTPProvider(config.BASE_RPC_URL))
        self.w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
        self.on_deployment_detected = on_deployment_detected
        self._last_block = None
        self._seen_contracts = set()

    def _is_contract_creation(self, tx):
        """Check if a transaction is a contract creation (to=None)."""
        return tx.get("to") is None

    def _get_contract_address(self, tx_hash):
        """Get the deployed contract address from a tx receipt."""
        try:
            receipt = self.w3.eth.get_transaction_receipt(tx_hash)
            return receipt.get("contractAddress")
        except Exception as e:
            logger.warning(f"Failed to get receipt for {tx_hash.hex()}: {e}")
            return None

    def _get_token_info(self, contract_address):
        """Try to read basic ERC-20 info from the deployed contract."""
        erc20_abi = [
            {"constant": True, "inputs": [], "name": "name", "outputs": [{"name": "", "type": "string"}], "type": "function"},
            {"constant": True, "inputs": [], "name": "symbol", "outputs": [{"name": "", "type": "string"}], "type": "function"},
            {"constant": True, "inputs": [], "name": "totalSupply", "outputs": [{"name": "", "type": "uint256"}], "type": "function"},
            {"constant": True, "inputs": [], "name": "decimals", "outputs": [{"name": "", "type": "uint8"}], "type": "function"},
        ]
        try:
            contract = self.w3.eth.contract(address=contract_address, abi=erc20_abi)
            name = contract.functions.name().call()
            symbol = contract.functions.symbol().call()
            total_supply = contract.functions.totalSupply().call()
            decimals = contract.functions.decimals().call()
            return {
                "token_name": name,
                "ticker": symbol,
                "total_supply": total_supply / (10 ** decimals),
                "decimals": decimals,
            }
        except Exception:
            return {}

    async def _scan_block(self, block_number):
        """Scan a block for contract deployments from watched wallets."""
        watched = {addr.lower() for addr in config.BANKRBOT_DEPLOYER_WALLETS}
        if not watched:
            return

        try:
            block = self.w3.eth.get_block(block_number, full_transactions=True)
        except Exception as e:
            logger.warning(f"Failed to fetch block {block_number}: {e}")
            return

        for tx in block.transactions:
            sender = tx.get("from", "").lower()
            if sender not in watched:
                continue
            if not self._is_contract_creation(tx):
                continue

            contract_address = self._get_contract_address(tx["hash"])
            if not contract_address:
                continue
            if contract_address in self._seen_contracts:
                continue
            self._seen_contracts.add(contract_address)

            token_info = self._get_token_info(contract_address)

            deployment = {
                "source": "chain",
                "contract_address": contract_address,
                "deployer_wallet": tx["from"],
                "tx_hash": tx["hash"].hex(),
                "block_number": block_number,
                "ticker": token_info.get("ticker"),
                "token_name": token_info.get("token_name"),
                "total_supply": token_info.get("total_supply"),
                "basescan_url": f"https://basescan.org/address/{contract_address}",
                "basescan_tx_url": f"https://basescan.org/tx/{tx['hash'].hex()}",
                "detected_at": datetime.now(timezone.utc).isoformat(),
            }

            logger.info(
                f"Deployment detected on-chain: {token_info.get('ticker', '???')} "
                f"CA: {contract_address}"
            )

            await self.on_deployment_detected(deployment)

    async def run(self):
        """Continuously scan new blocks for deployments."""
        if not config.BANKRBOT_DEPLOYER_WALLETS:
            logger.warning(
                "No BankrBot deployer wallets configured. "
                "Chain monitoring disabled. Add wallet addresses to config.BANKRBOT_DEPLOYER_WALLETS"
            )
            return

        logger.info(
            f"Chain monitor started, watching {len(config.BANKRBOT_DEPLOYER_WALLETS)} wallet(s)"
        )
        self._last_block = self.w3.eth.block_number

        while True:
            try:
                current_block = self.w3.eth.block_number
                if current_block > self._last_block:
                    for block_num in range(self._last_block + 1, current_block + 1):
                        await self._scan_block(block_num)
                    self._last_block = current_block
            except Exception as e:
                logger.error(f"Chain monitor error: {e}")

            await asyncio.sleep(config.CHAIN_POLL_INTERVAL_SECONDS)
