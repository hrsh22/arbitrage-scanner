/**
 * Minimal script to approve the Vault contract to spend USDC.e from the Treasury (Safe)
 * Usage: pnpm exec tsx src/scripts/approveVault.ts
 */
import "dotenv/config";
import { createSafeWalletService } from "../trading/safeWallet.js";

const TREASURY_ADDRESS = "0x5Eb9f355cCa830Bc1bB928D24509e278A0804B6b";
const VAULT_ADDRESS = "0x520174042c6B9d6b4dd2E144b0E50F478A5878c0";

async function main() {
  console.log("\n🔧 Approving Vault to spend Treasury's USDC.e...\n");
  console.log("Treasury (Safe):", TREASURY_ADDRESS);
  console.log("Vault Contract:", VAULT_ADDRESS);
  console.log("");

  const safeWallet = createSafeWalletService(TREASURY_ADDRESS);

  console.log("Submitting approval transaction...");
  const hash = await safeWallet.approveUsdcForSpender(VAULT_ADDRESS);
  
  console.log("\n✅ Approval submitted!");
  console.log("TX Hash:", hash);
  console.log("\nWait for the transaction to confirm, then you can claim your withdrawal.");
  
  process.exit(0);
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
