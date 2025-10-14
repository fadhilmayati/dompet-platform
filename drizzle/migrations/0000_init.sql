CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

CREATE TABLE IF NOT EXISTS "tenants" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "slug" text NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenants_slug_key" ON "tenants" ("slug");

CREATE TABLE IF NOT EXISTS "payment_connectors" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "connector_key" text NOT NULL,
    "display_name" text NOT NULL,
    "type" text NOT NULL,
    "status" text NOT NULL DEFAULT 'active',
    "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_connectors_tenant_key_unique"
    ON "payment_connectors" ("tenant_id", "connector_key");
CREATE INDEX IF NOT EXISTS "payment_connectors_tenant_idx"
    ON "payment_connectors" ("tenant_id");

CREATE TABLE IF NOT EXISTS "customers" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "external_reference" text NOT NULL,
    "email" text,
    "name" text,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "customers_tenant_reference_unique"
    ON "customers" ("tenant_id", "external_reference");
CREATE INDEX IF NOT EXISTS "customers_tenant_idx"
    ON "customers" ("tenant_id");

CREATE TABLE IF NOT EXISTS "wallet_accounts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
    "currency" varchar(3) NOT NULL,
    "balance" numeric(20, 2) NOT NULL DEFAULT 0,
    "status" text NOT NULL DEFAULT 'active',
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "wallet_accounts_tenant_idx"
    ON "wallet_accounts" ("tenant_id");
CREATE INDEX IF NOT EXISTS "wallet_accounts_customer_idx"
    ON "wallet_accounts" ("customer_id");

CREATE TABLE IF NOT EXISTS "payment_intents" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "wallet_account_id" uuid REFERENCES "wallet_accounts"("id") ON DELETE SET NULL,
    "customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
    "connector_id" uuid REFERENCES "payment_connectors"("id") ON DELETE SET NULL,
    "external_reference" text NOT NULL,
    "amount" numeric(20, 2) NOT NULL,
    "currency" varchar(3) NOT NULL,
    "status" text NOT NULL DEFAULT 'requires_action',
    "capture_method" text NOT NULL DEFAULT 'automatic',
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "description" text,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_intents_tenant_reference_unique"
    ON "payment_intents" ("tenant_id", "external_reference");
CREATE INDEX IF NOT EXISTS "payment_intents_tenant_idx"
    ON "payment_intents" ("tenant_id");
CREATE INDEX IF NOT EXISTS "payment_intents_wallet_idx"
    ON "payment_intents" ("wallet_account_id");

CREATE TABLE IF NOT EXISTS "payment_attempts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "intent_id" uuid NOT NULL REFERENCES "payment_intents"("id") ON DELETE CASCADE,
    "connector_id" uuid REFERENCES "payment_connectors"("id") ON DELETE SET NULL,
    "status" text NOT NULL DEFAULT 'pending',
    "error_code" text,
    "error_message" text,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "payment_attempts_intent_idx"
    ON "payment_attempts" ("intent_id");
CREATE INDEX IF NOT EXISTS "payment_attempts_connector_idx"
    ON "payment_attempts" ("connector_id");

CREATE TABLE IF NOT EXISTS "payment_events" (
    "id" bigserial PRIMARY KEY,
    "attempt_id" uuid NOT NULL REFERENCES "payment_attempts"("id") ON DELETE CASCADE,
    "event_type" text NOT NULL,
    "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "payment_events_attempt_idx"
    ON "payment_events" ("attempt_id");

CREATE TABLE IF NOT EXISTS "idempotency_keys" (
    "id" bigserial PRIMARY KEY,
    "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "idempotency_key" text NOT NULL,
    "request_hash" text,
    "response_payload" jsonb,
    "locked_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "expires_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_keys_unique_key"
    ON "idempotency_keys" ("tenant_id", "idempotency_key");

CREATE TABLE IF NOT EXISTS "customer_embeddings" (
    "id" bigserial PRIMARY KEY,
    "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
    "embedding" vector(1536) NOT NULL,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_embeddings_customer_unique"
    ON "customer_embeddings" ("tenant_id", "customer_id");
CREATE INDEX IF NOT EXISTS "customer_embeddings_tenant_idx"
    ON "customer_embeddings" ("tenant_id");
CREATE INDEX IF NOT EXISTS "customer_embeddings_embedding_idx"
    ON "customer_embeddings" USING ivfflat ("embedding" vector_cosine_ops);
