export interface SafeTransaction {
  to: string;
  data: string;
  value: string;
}

export interface TransactionResult {
  hash: string;
  success: boolean;
}

export interface TransactionRelayer {
  execute(safeAddress: string, transactions: SafeTransaction[]): Promise<TransactionResult>;
  deploySafe(ownerAddress: string): Promise<string>;
}

export interface PolymarketOrder {
  tokenId: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  feeRateBps?: number;
  nonce?: number;
  expiration?: number;
}

export interface OrderResult {
  orderId: string;
  status: "LIVE" | "MATCHED" | "CANCELLED" | "FAILED";
  filledSize?: number;
  avgPrice?: number;
}

export interface PolymarketMarket {
  conditionId: string;
  questionId: string;
  tokens: {
    tokenId: string;
    outcome: string;
    price: number;
  }[];
}
