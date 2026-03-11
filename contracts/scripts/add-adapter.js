const ethers = require("ethers");
require("dotenv").config();

const VAULT_ADDRESS = "0x066A4678935b78FA4E89e914dBE8F077764F0c74";
const ADAPTER_ADDRESS = "0x0cA15c34a35B090a4E46fF9f4D95D4A08DD4b525";
const RPC_URL =
  process.env.RPC_URL ||
  "https://polygon-mainnet.g.alchemy.com/v2/XeqbzKzOklvVcN5tsLW5VnSZ5ETutKuc";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const VAULT_ABI = [
  "function addAdapter(address adapter) external",
  "function curator() external view returns (address)",
  "function owner() external view returns (address)",
  "function executableAt(bytes calldata data) external view returns (uint256)",
  "function isAdapter(address adapter) external view returns (bool)",
  "function adapters() external view returns (address[] memory)",
  "function timelock(bytes4 selector) external view returns (uint256)",
  "event AddAdapter(address indexed adapter)",
];

async function main() {
  if (!PRIVATE_KEY) {
    console.error("PRIVATE_KEY not set in environment");
    console.log("Create a .env file with:");
    console.log("PRIVATE_KEY=0x...");
    console.log("RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY (optional)");
    process.exit(1);
  }

  console.log("Connecting to Polygon...");
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log("Wallet address:", wallet.address);
  console.log("Vault address:", VAULT_ADDRESS);
  console.log("Adapter address:", ADAPTER_ADDRESS);
  console.log("");

  const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, wallet);

  console.log("Checking pre-conditions...");

  const curator = await vault.curator();
  console.log("Curator:", curator);

  const owner = await vault.owner();
  console.log("Owner:", owner);

  const isAlreadyAdapter = await vault.isAdapter(ADAPTER_ADDRESS);
  console.log("Is already adapter:", isAlreadyAdapter);

  if (isAlreadyAdapter) {
    console.log("Adapter is already added! Nothing to do.");
    process.exit(0);
  }

  if (curator.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error("You are not the curator!");
    console.error("Your address:", wallet.address);
    console.error("Curator:", curator);
    process.exit(1);
  }

  const addAdapterInterface = new ethers.Interface([
    "function addAdapter(address adapter) external",
  ]);
  const addAdapterData = addAdapterInterface.encodeFunctionData("addAdapter", [ADAPTER_ADDRESS]);

  console.log("");
  console.log("Encoded call data:", addAdapterData);

  const executableAt = await vault.executableAt(addAdapterData);
  const now = Math.floor(Date.now() / 1000);
  console.log("");
  console.log("Timelock check:");
  console.log(
    "  Executable at:",
    executableAt.toString(),
    "(",
    new Date(Number(executableAt) * 1000).toISOString(),
    ")",
  );
  console.log("  Current time:", now, "(", new Date(now * 1000).toISOString(), ")");

  if (executableAt === 0n) {
    console.error("No pending submission found!");
    console.error("You need to call submit(bytes) first with the addAdapter data.");
    console.error("");
    console.error("Run this first:");
    console.error("  node submit-adapter.js");
    process.exit(1);
  }

  if (now < Number(executableAt)) {
    const waitSeconds = Number(executableAt) - now;
    console.error(`Timelock not expired yet! Wait ${waitSeconds} more seconds.`);
    process.exit(1);
  }

  console.log("Timelock expired! Ready to execute.");
  console.log("");

  const nonce = await wallet.getNonce();
  console.log("Using nonce:", nonce);
  console.log("Sending addAdapter transaction...");
  console.log("  Gas Limit: 300,000");
  console.log("  Max Fee: 400 gwei");
  console.log("  Priority Fee: 150 gwei");
  console.log("");

  try {
    const tx = await vault.addAdapter(ADAPTER_ADDRESS, {
      gasLimit: 300000,
      maxFeePerGas: ethers.parseUnits("400", "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits("150", "gwei"),
      nonce: nonce,
    });

    console.log("Transaction sent!");
    console.log("  Hash:", tx.hash);
    console.log("  Explorer: https://polygonscan.com/tx/" + tx.hash);
    console.log("");
    console.log("Waiting for confirmation...");

    const receipt = await tx.wait();

    console.log("");
    console.log("SUCCESS!");
    console.log("  Block:", receipt.blockNumber);
    console.log("  Gas used:", receipt.gasUsed.toString());
    console.log("  Status:", receipt.status === 1 ? "Success" : "Failed");

    if (receipt.status === 1) {
      const nowIsAdapter = await vault.isAdapter(ADAPTER_ADDRESS);
      console.log("  Adapter added:", nowIsAdapter);
    }
  } catch (error) {
    console.error("");
    console.error("Transaction failed!");
    console.error(error.message);

    if (error.reason) {
      console.error("Reason:", error.reason);
    }
    if (error.code) {
      console.error("Error code:", error.code);
    }

    process.exit(1);
  }
}

main().catch(console.error);
