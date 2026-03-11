import "dotenv/config";

import { AssetType, ClobClient } from "@polymarket/clob-client";
import { Wallet } from "ethers";
import { getVaultConfig, resolveVaultIdentity } from "../config/index.js";

const HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;

type SigType = 0 | 1 | 2;

interface AuthCheckResult {
  signatureType: SigType;
  ok: boolean;
  stage: "l1" | "l2" | "ok";
  error?: string;
}

async function checkWithSignatureType(
  signer: Wallet,
  funderAddress: string,
  signatureType: SigType,
): Promise<AuthCheckResult> {
  try {
    const l1Client = new ClobClient(
      HOST,
      CHAIN_ID,
      signer,
      undefined,
      signatureType,
      funderAddress,
      undefined,
      true,
    );
    const creds = await l1Client.createOrDeriveApiKey();
    if (!creds?.key || !creds?.secret || !creds?.passphrase) {
      return {
        signatureType,
        ok: false,
        stage: "l1",
        error: "createOrDeriveApiKey returned incomplete credentials",
      };
    }

    const l2Client = new ClobClient(
      HOST,
      CHAIN_ID,
      signer,
      creds,
      signatureType,
      funderAddress,
      undefined,
      true,
    );

    await l2Client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    return { signatureType, ok: true, stage: "ok" };
  } catch (error) {
    const message = (error as Error).message;
    const stage: AuthCheckResult["stage"] = message.toLowerCase().includes("api key") ? "l1" : "l2";
    return {
      signatureType,
      ok: false,
      stage,
      error: message,
    };
  }
}

async function main(): Promise<void> {
  const vaultIdArg = process.argv[2];
  if (!vaultIdArg) {
    console.error("Usage: npx tsx src/scripts/diagnoseClobAuth.ts <vaultId>");
    console.error("Example: npx tsx src/scripts/diagnoseClobAuth.ts 1");
    process.exit(1);
  }
  const vaultId = parseInt(vaultIdArg, 10);
  if (Number.isNaN(vaultId)) {
    console.error("Usage: npx tsx src/scripts/diagnoseClobAuth.ts <vaultId>");
    console.error("Example: npx tsx src/scripts/diagnoseClobAuth.ts 1");
    process.exit(1);
  }

  const config = getVaultConfig(vaultId);
  if (!config) {
    console.error(`Vault ${vaultId} not found in configuration`);
    process.exit(1);
  }
  console.log(`Using vault ${vaultId} (${config.name})`);
  console.log(`Single-Safe Mode: ${config.singleSafeMode === true ? "ENABLED" : "disabled"}`);

  // Pre-flight env var validation for single-safe mode
  if (config.singleSafeMode === true) {
    console.log("\n=== Environment Variable Checks ===");
    const envChecks: { name: string; set: boolean; value?: string }[] = [];

    // Check required env vars
    const tradingSignerKey = process.env[config.tradingSignerKeyEnv];
    envChecks.push({
      name: config.tradingSignerKeyEnv,
      set: !!tradingSignerKey,
      value: tradingSignerKey ? `${tradingSignerKey.slice(0, 10)}...` : undefined,
    });

    const allocatorKey = process.env[config.allocatorNavSignerKeyEnv];
    envChecks.push({
      name: config.allocatorNavSignerKeyEnv,
      set: !!allocatorKey,
      value: allocatorKey ? `${allocatorKey.slice(0, 10)}...` : undefined,
    });

    const safeOperatorKey = process.env[config.safeOperatorKeyEnv];
    envChecks.push({
      name: config.safeOperatorKeyEnv,
      set: !!safeOperatorKey,
      value: safeOperatorKey ? `${safeOperatorKey.slice(0, 10)}...` : undefined,
    });

    // In single-safe mode, tradingFunderAddress comes from config, not env
    envChecks.push({
      name: "tradingFunderAddress (from config)",
      set: !!config.tradingFunderAddress,
      value: config.tradingFunderAddress,
    });

    let allEnvSet = true;
    for (const check of envChecks) {
      const status = check.set ? "[PASS]" : "[FAIL]";
      console.log(`  ${status} ${check.name}: ${check.set ? check.value : "NOT SET"}`);
      if (!check.set) allEnvSet = false;
    }

    if (!allEnvSet) {
      console.log("\n[ERROR] Missing required environment variables.");
      console.log("Action: Set the missing env vars above before proceeding.");
      process.exit(1);
    }
    console.log("====================================\n");
  }
  console.log(`Using vault ${vaultId} (${config.name})`);
  console.log(`Single-Safe Mode: ${config.singleSafeMode === true ? "ENABLED" : "disabled"}`);

  let identity;
  try {
    identity = resolveVaultIdentity(config);
    console.log(
      `Resolved trading identity: signer=${identity.tradingSignerKey.slice(0, 10)}..., funder=${identity.tradingFunderAddress}`,
    );
  } catch (error) {
    console.error(`Failed to resolve vault identity: ${(error as Error).message}`);
    process.exit(1);
  }

  const privateKey = identity.tradingSignerKey;
  const funderAddress = identity.tradingFunderAddress;
  const safeAddress = identity.safeAddress;
  const configuredType = identity.tradingSignatureType;

  // Single-Safe Mode Invariant Checks
  const singleSafeChecks: {
    enabled: boolean;
    funderEqualsSafe: boolean;
    signatureTypeIsSafe: boolean;
    allPassed: boolean;
    failures: string[];
  } = {
    enabled: config.singleSafeMode === true,
    funderEqualsSafe: false,
    signatureTypeIsSafe: false,
    allPassed: false,
    failures: [],
  };

  if (config.singleSafeMode === true) {
    console.log("\n=== Single-Safe Mode Invariant Checks ===");

    // Check 1: funderAddress == safeAddress
    if (safeAddress !== undefined && funderAddress.toLowerCase() === safeAddress.toLowerCase()) {
      singleSafeChecks.funderEqualsSafe = true;
      console.log(`[PASS] safeAddress matches tradingFunderAddress: ${safeAddress}`);
    } else {
      singleSafeChecks.funderEqualsSafe = false;
      const failMsg = `safeAddress (${safeAddress}) does NOT match tradingFunderAddress (${funderAddress})`;
      singleSafeChecks.failures.push(failMsg);
      console.log(`[FAIL] ${failMsg}`);
    }

    // Check 2: signatureType == 2 (Safe)
    if (configuredType === 2) {
      singleSafeChecks.signatureTypeIsSafe = true;
      console.log(`[PASS] signatureType is 2 (Safe)`);
    } else {
      singleSafeChecks.signatureTypeIsSafe = false;
      const failMsg = `signatureType is ${configuredType}, expected 2 (Safe)`;
      singleSafeChecks.failures.push(failMsg);
      console.log(`[FAIL] ${failMsg}`);
    }

    singleSafeChecks.allPassed =
      singleSafeChecks.funderEqualsSafe && singleSafeChecks.signatureTypeIsSafe;

    if (singleSafeChecks.allPassed) {
      console.log("[PASS] All single-safe mode invariants satisfied");
    } else {
      console.log("[FAIL] Single-safe mode invariants violated - live mode would FAIL startup");
      for (const failure of singleSafeChecks.failures) {
        console.log(`       - ${failure}`);
      }
    }
    console.log("===========================================\n");
  } else {
    // Still compute funderEqualsSafe for info purposes
    singleSafeChecks.funderEqualsSafe =
      safeAddress !== undefined && funderAddress.toLowerCase() === safeAddress.toLowerCase();
  }

  if (!privateKey || !privateKey.startsWith("0x")) {
    throw new Error(
      `Vault ${vaultId}: Invalid tradingSignerKey from ${config.tradingSignerKeyEnv}`,
    );
  }
  if (!funderAddress) {
    throw new Error(
      `Vault ${vaultId}: Missing tradingFunderAddress from ${config.tradingFunderAddressEnv}`,
    );
  }

  const signer = new Wallet(privateKey);
  const signaturesToTest: SigType[] = [configuredType, 2, 1, 0].filter(
    (value, index, self) => self.indexOf(value) === index,
  ) as SigType[];

  const results: AuthCheckResult[] = [];
  for (const signatureType of signaturesToTest) {
    const result = await checkWithSignatureType(signer, funderAddress, signatureType);
    results.push(result);
    if (result.ok) break;
  }

  const successful = results.find((result) => result.ok);

  console.log(
    JSON.stringify(
      {
        vaultId,
        vaultName: config.name,
        singleSafeMode: config.singleSafeMode === true,
        singleSafeChecks: {
          enabled: singleSafeChecks.enabled,
          funderEqualsSafe: singleSafeChecks.funderEqualsSafe,
          signatureTypeIsSafe: singleSafeChecks.signatureTypeIsSafe,
          allPassed: singleSafeChecks.allPassed,
          failures: singleSafeChecks.failures,
        },
        signerAddress: signer.address,
        funderAddress,
        safeAddress,
        configuredSignatureType: configuredType,
        funderEqualsSafe: singleSafeChecks.funderEqualsSafe,
        results,
        recommendation: successful
          ? `Set VAULT_${vaultId}_TRADING_SIGNATURE_TYPE=${successful.signatureType} and ensure ${config.tradingFunderAddressEnv} is your Polymarket profile/proxy address from polymarket.com/settings`
          : `No signature type passed auth checks. Verify ${config.tradingFunderAddressEnv} is your Polymarket profile address (not arbitrary Safe), ensure this signer controls that Polymarket account, and login once on polymarket.com if proxy wallet is undeployed.`,
      },
      null,
      2,
    ),
  );

  if (!successful) {
    process.exit(1);
  }

  // Also fail if single-safe mode is enabled but checks failed
  if (config.singleSafeMode === true && !singleSafeChecks.allPassed) {
    console.error("\n[ERROR] Single-safe mode is enabled but invariants are violated.");
    console.error("Startup in live mode would fail. Fix the issues above before deploying.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`[diagnose:clob-auth] ${String((error as Error).message)}`);
  process.exit(1);
});
