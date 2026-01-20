CREATE TYPE "public"."error_severity" AS ENUM('critical', 'error', 'warning', 'info');--> statement-breakpoint
CREATE TABLE "bot_errors" (
	"id" serial PRIMARY KEY NOT NULL,
	"bot_instance_id" text DEFAULT '1' NOT NULL,
	"error_code" varchar(50) NOT NULL,
	"severity" "error_severity" DEFAULT 'error' NOT NULL,
	"message" text NOT NULL,
	"stack_trace" text,
	"component" varchar(100) NOT NULL,
	"function_name" varchar(100),
	"file_path" varchar(255),
	"line_number" integer,
	"request_id" varchar(64),
	"correlation_id" varchar(64),
	"position_id" integer,
	"market_id" text,
	"token_id" text,
	"environment" varchar(20) DEFAULT 'development' NOT NULL,
	"node_version" varchar(20),
	"app_version" varchar(20),
	"is_resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" varchar(100),
	"resolution_note" text,
	"error_hash" varchar(64),
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bot_errors_severity_idx" ON "bot_errors" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "bot_errors_component_idx" ON "bot_errors" USING btree ("component");--> statement-breakpoint
CREATE INDEX "bot_errors_error_code_idx" ON "bot_errors" USING btree ("error_code");--> statement-breakpoint
CREATE INDEX "bot_errors_created_idx" ON "bot_errors" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "bot_errors_instance_idx" ON "bot_errors" USING btree ("bot_instance_id");--> statement-breakpoint
CREATE INDEX "bot_errors_unresolved_idx" ON "bot_errors" USING btree ("is_resolved");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_errors_hash_unique" ON "bot_errors" USING btree ("error_hash");--> statement-breakpoint
CREATE INDEX "bot_errors_correlation_idx" ON "bot_errors" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "bot_errors_position_idx" ON "bot_errors" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "bot_errors_market_idx" ON "bot_errors" USING btree ("market_id");