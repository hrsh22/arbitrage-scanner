/**
 * Check wallet balance for the default bot.
 * Run with: npx tsx src/scripts/checkBalance.ts
 */

import { getTradingClient } from "../bot/tradingClient.js";
import bot1Config from "../bot/config/bots/bot1-default.js";

async function main() {
  console.log("Checking balance for bot:", bot1Config.name);
  console.log("Wallet env var:", bot1Config.walletPrivateKeyEnv);
  console.log("Funder env var:", bot1Config.walletFunderAddressEnv);
  console.log("");

  const client = getTradingClient(
    bot1Config.walletPrivateKeyEnv,
    bot1Config.walletFunderAddressEnv,
    bot1Config.minWalletReserve,
  );

  try {
    await client.initialize();
    console.log("Wallet address:", client.getWalletAddress());
    console.log("");

    const balance = await client.getBalance();
    console.log("USDC Balance:", balance.toFixed(6));
    console.log("Bet size:", bot1Config.betSize);
    console.log("Can place bet:", balance >= bot1Config.betSize ? "YES" : "NO");
  } catch (error) {
    console.error("Error:", (error as Error).message);
    process.exit(1);
  }
}

main();
