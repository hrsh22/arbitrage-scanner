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
  console.log(`Trading wallet/funder: ${config.safeAddress}`);

  let identity;
  try {
    identity = resolveVaultIdentity(config);
    console.log(`Resolved vault identity: wallet=${identity.safeAddress}`);
  } catch (error) {
    console.error(`Failed to resolve vault identity: ${(error as Error).message}`);
    process.exit(1);
  }

  const privateKey = identity.tradingSignerKey;
  const funderAddress = identity.safeAddress;
  const configuredType = identity.tradingSignatureType ?? 2;

  if (!privateKey || !privateKey.startsWith("0x")) {
    console.error(
      `Vault ${vaultId}: trading signer is not configured in vault-api. This is expected when trading is handled by an external bot.`,
    );
    process.exit(0);
  }
  if (!funderAddress) {
    throw new Error(`Vault ${vaultId}: Missing safeAddress in vault config`);
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
        signerAddress: signer.address,
        funderAddress,
        configuredSignatureType: configuredType,
        results,
        recommendation: successful
          ? `Set VAULT_${vaultId}_TRADING_SIGNATURE_TYPE=${successful.signatureType} and ensure safeAddress matches the Polymarket profile/proxy funder address.`
          : "No signature type passed auth checks. Verify safeAddress is the Polymarket profile/proxy funder address, ensure this signer controls that Polymarket account, and login once on polymarket.com if proxy wallet is undeployed.",
      },
      null,
      2,
    ),
  );

  if (!successful) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`[diagnose:clob-auth] ${String((error as Error).message)}`);
  process.exit(1);
});
