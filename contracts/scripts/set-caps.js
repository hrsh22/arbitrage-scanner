const ethers = require("ethers");
require("dotenv").config();

const VAULT_ADDRESS = "0x066A4678935b78FA4E89e914dBE8F077764F0c74";
const RPC_URL =
  process.env.RPC_URL ||
  "https://polygon-mainnet.g.alchemy.com/v2/XeqbzKzOklvVcN5tsLW5VnSZ5ETutKuc";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const VAULT_ABI = [
  "function submit(bytes) external",
  "function increaseAbsoluteCap(bytes,uint256) external",
  "function increaseRelativeCap(bytes,uint256) external",
  "function curator() external view returns (address)",
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

  const curator = await vault.curator();
  if (curator.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error("Not curator!");
    process.exit(1);
  }

  const absCapData = vault.interface.encodeFunctionData("increaseAbsoluteCap", [
    "0x0000000000000000000000000000000000000000000000000000000000000000",
    "10000000",
  ]);

  const relCapData = vault.interface.encodeFunctionData("increaseRelativeCap", [
    "0x0000000000000000000000000000000000000000000000000000000000000000",
    "1000000000000000000",
  ]);

  const absExecutable = await vault.executableAt(absCapData);
  const relExecutable = await vault.executableAt(relCapData);
  const now = Math.floor(Date.now() / 1000);

  if (absExecutable === 0n) {
    console.log("Submitting absolute cap ($10)...");
    const tx1 = await vault.submit(absCapData, {
      gasLimit: 300000,
      maxFeePerGas: ethers.parseUnits("400", "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits("150", "gwei"),
    });
    console.log("Hash:", tx1.hash);
    await tx1.wait();
    console.log("Submitted!");
  } else if (now < Number(absExecutable)) {
    console.log("Absolute cap pending. Wait " + (Number(absExecutable) - now) + "s");
  }

  if (relExecutable === 0n) {
    console.log("Submitting relative cap (100%)...");
    const tx2 = await vault.submit(relCapData, {
      gasLimit: 300000,
      maxFeePerGas: ethers.parseUnits("400", "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits("150", "gwei"),
    });
    console.log("Hash:", tx2.hash);
    await tx2.wait();
    console.log("Submitted!");
  } else if (now < Number(relExecutable)) {
    console.log("Relative cap pending. Wait " + (Number(relExecutable) - now) + "s");
  }

  const absExecutable2 = await vault.executableAt(absCapData);
  if (absExecutable2 > 0n && now >= Number(absExecutable2)) {
    console.log("Executing absolute cap...");
    const tx3 = await vault.increaseAbsoluteCap(
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      "10000000",
      {
        gasLimit: 300000,
        maxFeePerGas: ethers.parseUnits("400", "gwei"),
        maxPriorityFeePerGas: ethers.parseUnits("150", "gwei"),
      },
    );
    console.log("Hash:", tx3.hash);
    await tx3.wait();
    console.log("Absolute cap set!");
  }

  const relExecutable2 = await vault.executableAt(relCapData);
  if (relExecutable2 > 0n && now >= Number(relExecutable2)) {
    console.log("Executing relative cap...");
    const tx4 = await vault.increaseRelativeCap(
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      "1000000000000000000",
      {
        gasLimit: 300000,
        maxFeePerGas: ethers.parseUnits("400", "gwei"),
        maxPriorityFeePerGas: ethers.parseUnits("150", "gwei"),
      },
    );
    console.log("Hash:", tx4.hash);
    await tx4.wait();
    console.log("Relative cap set!");
  }

  console.log("All caps configured!");
}

main().catch(console.error);
