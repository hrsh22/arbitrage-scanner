const ethers = require("ethers");
require("dotenv").config();

const VAULT_ADDRESS = "0x066A4678935b78FA4E89e914dBE8F077764F0c74";
const ADAPTER_ADDRESS = "0x0cA15c34a35B090a4E46fF9f4D95D4A08DD4b525";
const RPC_URL =
  process.env.RPC_URL ||
  "https://polygon-mainnet.g.alchemy.com/v2/XeqbzKzOklvVcN5tsLW5VnSZ5ETutKuc";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const VAULT_ABI = [
  "function submit(bytes calldata data) external",
  "function curator() external view returns (address)",
  "function owner() external view returns (address)",
  "function timelock(bytes4 selector) external view returns (uint256)",
  "function executableAt(bytes calldata data) external view returns (uint256)",
];

async function main() {
  if (!PRIVATE_KEY) {
    console.error("PRIVATE_KEY not set in environment");
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

  if (curator.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error("You are not the curator!");
    process.exit(1);
  }

  const addAdapterInterface = new ethers.Interface([
    "function addAdapter(address adapter) external",
  ]);
  const addAdapterData = addAdapterInterface.encodeFunctionData("addAdapter", [ADAPTER_ADDRESS]);

  console.log("");
  console.log("addAdapter encoded data:", addAdapterData);
  console.log("Selector:", addAdapterData.slice(0, 10));

  const selector = addAdapterData.slice(0, 10);
  const timelockDuration = await vault.timelock(selector);
  console.log("");
  console.log("Timelock for addAdapter:", timelockDuration.toString(), "seconds");

  const currentExecutableAt = await vault.executableAt(addAdapterData);
  console.log("Current executableAt:", currentExecutableAt.toString());

  if (currentExecutableAt > 0) {
    const now = Math.floor(Date.now() / 1000);
    if (now >= Number(currentExecutableAt)) {
      console.log("Already submitted and timelock expired!");
      console.log("Run: node add-adapter.js");
      process.exit(0);
    } else {
      const waitSeconds = Number(currentExecutableAt) - now;
      console.log(`Already submitted. Wait ${waitSeconds} more seconds.`);
      process.exit(0);
    }
  }

  const nonce = await wallet.getNonce();
  console.log("");
  console.log("Using nonce:", nonce, "(will replace any stuck transaction)");
  console.log("Submitting addAdapter to timelock...");
  console.log("Gas Limit: 300,000");
  console.log("Max Fee: 400 gwei");
  console.log("Priority Fee: 150 gwei");
  console.log("");

  try {
    const tx = await vault.submit(addAdapterData, {
      gasLimit: 300000,
      maxFeePerGas: ethers.parseUnits("400", "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits("150", "gwei"),
      nonce: nonce,
    });

    console.log("Transaction sent!");
    console.log("Hash:", tx.hash);
    console.log("Explorer: https://polygonscan.com/tx/" + tx.hash);
    console.log("");
    console.log("Waiting for confirmation...");

    const receipt = await tx.wait();

    console.log("");
    console.log("SUCCESS!");
    console.log("Block:", receipt.blockNumber);
    console.log("Gas used:", receipt.gasUsed.toString());

    const newExecutableAt = await vault.executableAt(addAdapterData);
    const now = Math.floor(Date.now() / 1000);
    const waitSeconds = Number(newExecutableAt) - now;

    console.log("");
    console.log("Timelock set!");
    console.log("Executable at:", new Date(Number(newExecutableAt) * 1000).toISOString());

    if (timelockDuration === 0n) {
      console.log("Timelock is 0 - you can execute immediately!");
      console.log("Run: node add-adapter.js");
    } else {
      console.log(`Wait ${waitSeconds} seconds, then run: node add-adapter.js`);
    }
  } catch (error) {
    console.error("");
    console.error("Transaction failed!");
    console.error(error.message);

    if (error.reason) {
      console.error("Reason:", error.reason);
    }

    process.exit(1);
  }
}

main().catch(console.error);
