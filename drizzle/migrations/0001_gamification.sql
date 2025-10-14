CREATE TABLE IF NOT EXISTS "users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "email" varchar(255) NOT NULL,
    "name" text NOT NULL,
    "role" text NOT NULL DEFAULT 'member',
    "avatar_url" text,
    "profile" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_tenant_email_unique"
    ON "users" ("tenant_id", "email");
CREATE INDEX IF NOT EXISTS "users_tenant_idx"
    ON "users" ("tenant_id");

CREATE TABLE IF NOT EXISTS "badges" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "slug" text NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "icon" text,
    "criteria" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "badges_tenant_slug_unique"
    ON "badges" ("tenant_id", "slug");
CREATE INDEX IF NOT EXISTS "badges_tenant_idx"
    ON "badges" ("tenant_id");

CREATE TABLE IF NOT EXISTS "transactions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "amount" numeric(20, 2) NOT NULL,
    "currency" varchar(3) NOT NULL,
    "type" text NOT NULL,
    "category" text,
    "description" text,
    "occurred_at" timestamptz NOT NULL,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "transactions_tenant_idx"
    ON "transactions" ("tenant_id");
CREATE INDEX IF NOT EXISTS "transactions_user_idx"
    ON "transactions" ("user_id");
CREATE INDEX IF NOT EXISTS "transactions_occurred_idx"
    ON "transactions" ("occurred_at");

CREATE TABLE IF NOT EXISTS "rules" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
    "name" text NOT NULL,
    "description" text,
    "trigger" text NOT NULL,
    "conditions" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "actions" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "is_active" boolean NOT NULL DEFAULT true,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "rules_tenant_idx"
    ON "rules" ("tenant_id");

CREATE TABLE IF NOT EXISTS "challenges" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "slug" text NOT NULL,
    "title" text NOT NULL,
    "description" text,
    "metric" text NOT NULL,
    "target_value" numeric(20, 2) NOT NULL,
    "window" text NOT NULL,
    "reward_badge_id" uuid REFERENCES "badges"("id") ON DELETE SET NULL,
    "starts_at" timestamptz NOT NULL,
    "ends_at" timestamptz NOT NULL,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "challenges_tenant_slug_unique"
    ON "challenges" ("tenant_id", "slug");
CREATE INDEX IF NOT EXISTS "challenges_tenant_idx"
    ON "challenges" ("tenant_id");
CREATE INDEX IF NOT EXISTS "challenges_badge_idx"
    ON "challenges" ("reward_badge_id");
