import "dotenv/config";
import { ClobClient } from "@polymarket/clob-client";
import { Wallet } from "ethers";
import { createSafeWalletService } from "../trading/safeWallet.js";
import { env, getRpcUrl } from "../env.js";

const CHAIN_ID = 137;
const POLYMARKET_CLOB_URL = "https://clob.polymarket.com";

async function main() {
  const safeAddress = process.argv[2];
  const vaultContractAddress = process.argv[3];

  if (!safeAddress) {
    console.error("\n❌ Usage: pnpm setup-safe <SAFE_ADDRESS> [VAULT_CONTRACT_ADDRESS]\n");
    console.error("Example: pnpm setup-safe 0x1234...abcd 0x5678...efgh\n");
    process.exit(1);
  }

  if (!env.TRADING_WALLET_PRIVATE_KEY) {
    console.error("\n❌ TRADING_WALLET_PRIVATE_KEY not set in .env\n");
    process.exit(1);
  }

  console.log("\n🔧 Setting up Safe for Polymarket trading...\n");
  console.log("Safe Address:", safeAddress);
  if (vaultContractAddress) {
    console.log("Vault Contract:", vaultContractAddress);
  }
  console.log("RPC:", getRpcUrl());
  console.log("");

  const wallet = new Wallet(env.TRADING_WALLET_PRIVATE_KEY);
  console.log("Trading Wallet:", wallet.address);
  console.log("");

  console.log("─".repeat(50));
  console.log("Step 1: Approving tokens for Polymarket contracts...");
  console.log("─".repeat(50));

  try {
    const safeWallet = createSafeWalletService(safeAddress);

    console.log("  → Setting all Polymarket approvals (USDC.e + outcome tokens)...");
    const polymarketHash = await safeWallet.approveAllForPolymarket();
    console.log("    ✓ TX:", polymarketHash);

    if (vaultContractAddress) {
      console.log("  → Approving native USDC for Vault contract (claim withdrawals)...");
      const vaultHash = await safeWallet.approveNativeUsdcForSpender(vaultContractAddress);
      console.log("    ✓ TX:", vaultHash);
    }

    console.log("");
  } catch (error) {
    console.error("  ✗ Approval failed:", (error as Error).message);
    console.error("\n  Make sure:");
    console.error("  - Trading wallet has MATIC for gas");
    console.error("  - Trading wallet is an owner of the Safe");
    console.error("  - Safe is deployed on Polygon mainnet\n");
    process.exit(1);
  }

  console.log("─".repeat(50));
  console.log("Step 2: Registering with Polymarket CLOB...");
  console.log("─".repeat(50));

  try {
    const client = new ClobClient(
      POLYMARKET_CLOB_URL,
      CHAIN_ID,
      wallet,
      undefined,
      undefined,
      safeAddress,
    );

    console.log("  → Registering/verifying API credentials...");
    await client.createOrDeriveApiKey();
    console.log("    ✓ API credentials verified");
    console.log("");

    console.log("═".repeat(50));
    console.log("✅ SETUP COMPLETE");
    console.log("═".repeat(50));
    console.log("");
    console.log("Your Safe is now configured for Polymarket trading.");
    console.log("API credentials are derived automatically on each use.");
    console.log("No additional .env configuration needed for this Safe.");
    console.log("");
    console.log("Next steps:");
    console.log("  1. Fund the Safe with USDC");
    console.log("  2. Create a vault in the admin panel");
    console.log("  3. Start trading!");
    console.log("");
  } catch (error) {
    console.error("  ✗ CLOB registration failed:", (error as Error).message);
    console.error("\n  This might happen if:");
    console.error("  - Polymarket CLOB is down");
    console.error("  - Network issues");
    console.error("  - Safe not properly set up\n");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
