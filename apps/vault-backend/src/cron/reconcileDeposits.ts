import "dotenv/config";
import { catchUpAllVaults } from "../services/depositListener.js";
import { logger } from "../logger.js";

async function main() {
  logger.info("Starting deposit reconciliation");

  try {
    await catchUpAllVaults();
    logger.info("Deposit reconciliation completed successfully");
    process.exit(0);
  } catch (error) {
    logger.error("Deposit reconciliation failed", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    process.exit(1);
  }
}

main();
