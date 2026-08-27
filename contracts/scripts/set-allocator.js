const ethers = require("ethers");
require("dotenv").config();

const VAULT_ADDRESS = "0x066A4678935b78FA4E89e914dBE8F077764F0c74";
const BACKEND_WALLET = "0xA40626A1b90030f3F6036dFf51E2B23fff0EE259";
const RPC_URL =
  process.env.RPC_URL ||
  "https://polygon-mainnet.g.alchemy.com/v2/XeqbzKzOklvVcN5tsLW5VnSZ5ETutKuc";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const VAULT_ABI = [
  "function submit(bytes) external",
  "function setIsAllocator(address,bool) external",
  "function curator() external view returns (address)",
  "function isAllocator(address) external view returns (bool)",
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
  console.log("Backend:", BACKEND_WALLET);

  const curator = await vault.curator();
  if (curator.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error("Not curator!");
    process.exit(1);
  }

  const isAlready = await vault.isAllocator(BACKEND_WALLET);
  if (isAlready) {
    console.log("Already allocator!");
    process.exit(0);
  }

  const allocData = vault.interface.encodeFunctionData("setIsAllocator", [BACKEND_WALLET, true]);
  const executable = await vault.executableAt(allocData);
  const now = Math.floor(Date.now() / 1000);

  if (executable === 0n) {
    console.log("Submitting allocator...");
    const tx1 = await vault.submit(allocData, {
      gasLimit: 300000,
      maxFeePerGas: ethers.parseUnits("400", "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits("150", "gwei"),
    });
    console.log("Hash:", tx1.hash);
    await tx1.wait();
    console.log("Submitted!");
  } else if (now < Number(executable)) {
    console.log("Pending. Wait " + (Number(executable) - now) + "s");
  }

  const executable2 = await vault.executableAt(allocData);
  if (executable2 > 0n && now >= Number(executable2)) {
    console.log("Executing allocator...");
    const tx2 = await vault.setIsAllocator(BACKEND_WALLET, true, {
      gasLimit: 300000,
      maxFeePerGas: ethers.parseUnits("400", "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits("150", "gwei"),
    });
    console.log("Hash:", tx2.hash);
    await tx2.wait();
    console.log("Allocator set!");
  }

  const nowIs = await vault.isAllocator(BACKEND_WALLET);
  console.log("Is allocator:", nowIs);
}

main().catch(console.error);
