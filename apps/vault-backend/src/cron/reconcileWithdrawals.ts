import "dotenv/config";
import { catchUpAllVaultsWithdrawals } from "../services/withdrawalListener.js";
import { logger } from "../logger.js";

async function main() {
  logger.info("Starting withdrawal reconciliation");

  try {
    await catchUpAllVaultsWithdrawals();
    logger.info("Withdrawal reconciliation completed successfully");
    process.exit(0);
  } catch (error) {
    logger.error("Withdrawal reconciliation failed", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    process.exit(1);
  }
}

main();
