const ethers = require("ethers");
require("dotenv").config();

const VAULT_ADDRESS = "0x066A4678935b78FA4E89e914dBE8F077764F0c74";
const ADAPTER_ADDRESS = "0x0cA15c34a35B090a4E46fF9f4D95D4A08DD4b525";
const RPC_URL =
  process.env.RPC_URL ||
  "https://polygon-mainnet.g.alchemy.com/v2/XeqbzKzOklvVcN5tsLW5VnSZ5ETutKuc";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const VAULT_ABI = [
  "function submit(bytes) external",
  "function increaseAbsoluteCap(bytes,uint256) external",
  "function increaseRelativeCap(bytes,uint256) external",
  "function absoluteCap(bytes32) external view returns (uint256)",
  "function relativeCap(bytes32) external view returns (uint256)",
  "function executableAt(bytes) external view returns (uint256)",
];

async function main() {
  if (!PRIVATE_KEY) {
    console.error("PRIVATE_KEY not set");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, wallet);

  console.log("Wallet:", wallet.address);
  console.log("Vault:", VAULT_ADDRESS);
  console.log("Adapter:", ADAPTER_ADDRESS);

  // The correct id for increaseAbsoluteCap is the PREIMAGE of adapterId.
  // adapterId = keccak256(abi.encode("PolymarketAdapter", address(adapter)))
  // So the preimage = abi.encode("PolymarketAdapter", address(adapter))
  // When the vault hashes this preimage, it gets adapterId,
  // which is what the adapter returns in ids().
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const preimage = abiCoder.encode(["string", "address"], ["PolymarketAdapter", ADAPTER_ADDRESS]);
  const adapterId = ethers.keccak256(preimage);

  console.log("\nPreimage (abi.encode):", preimage);
  console.log("adapterId (keccak256):", adapterId);

  // Check current cap at adapterId
  const currentAbsCap = await vault.absoluteCap(adapterId);
  const currentRelCap = await vault.relativeCap(adapterId);
  console.log("\nCurrent absoluteCap(adapterId):", currentAbsCap.toString());
  console.log("Current relativeCap(adapterId):", currentRelCap.toString());

  if (currentAbsCap > 0n) {
    console.log("\n✅ Absolute cap already set at correct key!");
    if (currentRelCap > 0n) {
      console.log("✅ Relative cap already set at correct key!");
      console.log("Nothing to do.");
      return;
    }
  }

  // Set absolute cap: 1,000,000 USDC.e (6 decimals) = 1_000_000_000_000
  const absoluteCapValue = "1000000000000"; // 1M USDC.e
  // Set relative cap: 100% = 1e18
  const relativeCapValue = "1000000000000000000"; // 1e18

  const gasConfig = {
    gasLimit: 300000,
    maxFeePerGas: ethers.parseUnits("100", "gwei"),
    maxPriorityFeePerGas: ethers.parseUnits("50", "gwei"),
  };

  // Step 1: Submit absolute cap
  const absCapData = vault.interface.encodeFunctionData("increaseAbsoluteCap", [
    preimage,
    absoluteCapValue,
  ]);

  const absExecutable = await vault.executableAt(absCapData);
  const now = Math.floor(Date.now() / 1000);

  if (absExecutable === 0n) {
    console.log("\nSubmitting absolute cap (1M USDC.e)...");
    const tx1 = await vault.submit(absCapData, gasConfig);
    console.log("Submit tx:", tx1.hash);
    await tx1.wait();
    console.log("Submitted!");
  } else if (now < Number(absExecutable)) {
    console.log("Absolute cap pending. Wait " + (Number(absExecutable) - now) + "s");
  }

  // Execute absolute cap
  const absExecutable2 = await vault.executableAt(absCapData);
  if (absExecutable2 > 0n && now >= Number(absExecutable2)) {
    console.log("Executing absolute cap...");
    const tx2 = await vault.increaseAbsoluteCap(preimage, absoluteCapValue, gasConfig);
    console.log("Execute tx:", tx2.hash);
    await tx2.wait();
    console.log("✅ Absolute cap set!");
  }

  // Step 2: Submit relative cap
  const relCapData = vault.interface.encodeFunctionData("increaseRelativeCap", [
    preimage,
    relativeCapValue,
  ]);

  const relExecutable = await vault.executableAt(relCapData);
  if (relExecutable === 0n) {
    console.log("\nSubmitting relative cap (100%)...");
    const tx3 = await vault.submit(relCapData, gasConfig);
    console.log("Submit tx:", tx3.hash);
    await tx3.wait();
    console.log("Submitted!");
  } else if (now < Number(relExecutable)) {
    console.log("Relative cap pending. Wait " + (Number(relExecutable) - now) + "s");
  }

  // Execute relative cap
  const relExecutable2 = await vault.executableAt(relCapData);
  if (relExecutable2 > 0n && now >= Number(relExecutable2)) {
    console.log("Executing relative cap...");
    const tx4 = await vault.increaseRelativeCap(preimage, relativeCapValue, gasConfig);
    console.log("Execute tx:", tx4.hash);
    await tx4.wait();
    console.log("✅ Relative cap set!");
  }

  // Verify
  const finalAbsCap = await vault.absoluteCap(adapterId);
  const finalRelCap = await vault.relativeCap(adapterId);
  console.log("\n=== Verification ===");
  console.log("absoluteCap(adapterId):", finalAbsCap.toString());
  console.log("relativeCap(adapterId):", finalRelCap.toString());

  if (finalAbsCap > 0n && finalRelCap > 0n) {
    console.log("\n✅ All caps correctly set! allocate() should now work.");
  } else {
    console.log("\n⚠️ Caps may not be fully set yet. Re-run this script.");
  }
}

main().catch(console.error);
