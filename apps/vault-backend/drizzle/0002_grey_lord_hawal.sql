ALTER TABLE "withdrawal_requests" ADD COLUMN "on_chain_request_id" integer;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "current_claimable_usdc" numeric(18, 6) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "last_merkle_root" text;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "last_merkle_proof" text;--> statement-breakpoint
CREATE INDEX "withdrawal_requests_on_chain_idx" ON "withdrawal_requests" USING btree ("on_chain_request_id");