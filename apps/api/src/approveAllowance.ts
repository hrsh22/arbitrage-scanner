import "dotenv/config";
import { getTradingClient } from "./bot/tradingClient.js";

async function main() {
  const client = getTradingClient();

  const privateKey = process.env.POLYMARKET_PRIVATE_KEY;
  if (!privateKey) {
    console.error("POLYMARKET_PRIVATE_KEY not set");
    process.exit(1);
  }

  console.log("Initializing trading client...");
  await client.initialize();

  console.log("Approving USDC allowance...");
  const result = await client.approveAllowance();

  if (result.success) {
    console.log("✅ Approval successful!");
    console.log("TX Hash:", result.txHash);
  } else {
    console.error("❌ Approval failed:", result.error);
    process.exit(1);
  }
}

main().catch(console.error);
