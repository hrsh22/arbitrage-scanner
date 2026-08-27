import "dotenv/config";

import { AssetType, Chain, ClobClient, type SignatureTypeV2 } from "@polymarket/clob-client-v2";
import { Wallet } from "ethers";
import { getVaultConfig, resolveVaultIdentity } from "../config/index.js";

const HOST = "https://clob.polymarket.com";
type SigType = SignatureTypeV2;

interface AuthCheckResult {
  signatureType: SigType;
  ok: boolean;
  stage: "l1" | "l2" | "ok";
  error?: string;
}

interface ClobApiCreds {
  key: string;
  secret: string;
  passphrase: string;
}

function isClobApiCreds(value: unknown): value is ClobApiCreds {
  const candidate = value as Partial<ClobApiCreds> | null;
  return Boolean(candidate?.key && candidate.secret && candidate.passphrase);
}

async function withSuppressedClobRequestLogs<T>(callback: () => Promise<T>): Promise<T> {
  const originalError = console.error;

  console.error = (...args: unknown[]) => {
    const firstArg = args[0];
    if (typeof firstArg === "string" && firstArg.includes("[CLOB Client] request error")) {
      return;
    }

    originalError(...args);
  };

  try {
    return await callback();
  } finally {
    console.error = originalError;
  }
}

async function createOrDeriveApiCredentials(client: ClobClient): Promise<ClobApiCreds> {
  return withSuppressedClobRequestLogs(async () => {
    try {
      const createdOrDerived = await client.createOrDeriveApiKey();
      if (isClobApiCreds(createdOrDerived)) {
        return createdOrDerived;
      }
    } catch {
      // createOrDeriveApiKey does not catch createApiKey failures in clob-client-v2.
      // Derive explicitly so existing keys can still be recovered without logging request headers.
    }

    const derived = await client.deriveApiKey();
    if (!isClobApiCreds(derived)) {
      throw new Error("createOrDeriveApiKey returned incomplete credentials");
    }

    return derived;
  });
}

async function checkWithSignatureType(
  signer: Wallet,
  funderAddress: string,
  signatureType: SigType,
): Promise<AuthCheckResult> {
  try {
    const l1Client = new ClobClient({
      host: HOST,
      chain: Chain.POLYGON,
      signer,
    });
    const creds = await createOrDeriveApiCredentials(l1Client);

    const l2Client = new ClobClient({
      host: HOST,
      chain: Chain.POLYGON,
      signer,
      creds,
      signatureType,
      funderAddress,
      throwOnError: true,
    });

    await withSuppressedClobRequestLogs(() =>
      l2Client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL }),
    );
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
  const signaturesToTest: SigType[] = [configuredType, 3, 2, 1, 0].filter(
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
