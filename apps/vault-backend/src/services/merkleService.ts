import { keccak256, encodePacked } from "viem";

export interface ClaimLeaf {
  requestId: number;
  cumulativeClaimable: bigint;
}

export interface MerkleResult {
  root: `0x${string}`;
  proofs: Map<number, `0x${string}`[]>;
}

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

/**
 * Matches Solidity: keccak256(abi.encodePacked(requestId, cumulativeClaimable))
 */
export function generateLeafHash(requestId: number, cumulativeClaimable: bigint): `0x${string}` {
  return keccak256(encodePacked(["uint256", "uint256"], [BigInt(requestId), cumulativeClaimable]));
}

function hashPair(a: `0x${string}`, b: `0x${string}`): `0x${string}` {
  const [left, right] = a < b ? [a, b] : [b, a];
  return keccak256(encodePacked(["bytes32", "bytes32"], [left, right]));
}

/**
 * Builds Merkle tree compatible with OpenZeppelin MerkleProof.verify().
 * Uses raw keccak256 for leaves (NOT StandardMerkleTree which double-hashes).
 */
export function buildClaimTree(claims: ClaimLeaf[]): MerkleResult {
  if (claims.length === 0) {
    return { root: ZERO_BYTES32, proofs: new Map() };
  }

  const leaves = claims.map((c) => ({
    requestId: c.requestId,
    hash: generateLeafHash(c.requestId, c.cumulativeClaimable),
  }));

  leaves.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));

  const layers: `0x${string}`[][] = [leaves.map((l) => l.hash)];

  while (layers[layers.length - 1]!.length > 1) {
    const currentLayer = layers[layers.length - 1]!;
    const nextLayer: `0x${string}`[] = [];

    for (let i = 0; i < currentLayer.length; i += 2) {
      if (i + 1 < currentLayer.length) {
        nextLayer.push(hashPair(currentLayer[i]!, currentLayer[i + 1]!));
      } else {
        nextLayer.push(currentLayer[i]!);
      }
    }
    layers.push(nextLayer);
  }

  const root = layers[layers.length - 1]![0]!;
  const proofs = new Map<number, `0x${string}`[]>();

  for (const leaf of leaves) {
    const proof: `0x${string}`[] = [];
    let index = layers[0]!.indexOf(leaf.hash);

    for (let layerIndex = 0; layerIndex < layers.length - 1; layerIndex++) {
      const layer = layers[layerIndex]!;
      const isLeft = index % 2 === 0;
      const siblingIndex = isLeft ? index + 1 : index - 1;

      if (siblingIndex >= 0 && siblingIndex < layer.length) {
        proof.push(layer[siblingIndex]!);
      }

      index = Math.floor(index / 2);
    }

    proofs.set(leaf.requestId, proof);
  }

  return { root, proofs };
}

export function serializeProof(proof: `0x${string}`[]): string {
  return JSON.stringify(proof);
}

export function deserializeProof(serialized: string): `0x${string}`[] {
  return JSON.parse(serialized) as `0x${string}`[];
}
