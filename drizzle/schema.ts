import { relations, sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  vector,
} from "drizzle-orm/pg-core";

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    slugUnique: uniqueIndex("tenants_slug_key").on(table.slug),
  })
);

export const paymentConnectors = pgTable(
  "payment_connectors",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    connectorKey: text("connector_key").notNull(),
    displayName: text("display_name").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull().default("active"),
    config: jsonb("config")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tenantKeyUnique: uniqueIndex("payment_connectors_tenant_key_unique").on(
      table.tenantId,
      table.connectorKey
    ),
    tenantIdx: index("payment_connectors_tenant_idx").on(table.tenantId),
  })
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    externalReference: text("external_reference").notNull(),
    email: text("email"),
    name: text("name"),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tenantReferenceUnique: uniqueIndex(
      "customers_tenant_reference_unique"
    ).on(table.tenantId, table.externalReference),
    tenantIdx: index("customers_tenant_idx").on(table.tenantId),
  })
);

export const walletAccounts = pgTable(
  "wallet_accounts",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    currency: varchar("currency", { length: 3 }).notNull(),
    balance: numeric("balance", { precision: 20, scale: 2 })
      .notNull()
      .default(sql`0`),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tenantIdx: index("wallet_accounts_tenant_idx").on(table.tenantId),
    customerIdx: index("wallet_accounts_customer_idx").on(table.customerId),
  })
);

export const paymentIntents = pgTable(
  "payment_intents",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    walletAccountId: uuid("wallet_account_id").references(
      () => walletAccounts.id,
      {
        onDelete: "set null",
      }
    ),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    connectorId: uuid("connector_id").references(() => paymentConnectors.id, {
      onDelete: "set null",
    }),
    externalReference: text("external_reference").notNull(),
    amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    status: text("status").notNull().default("requires_action"),
    captureMethod: text("capture_method").notNull().default("automatic"),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tenantReferenceUnique: uniqueIndex(
      "payment_intents_tenant_reference_unique"
    ).on(table.tenantId, table.externalReference),
    tenantIdx: index("payment_intents_tenant_idx").on(table.tenantId),
    walletIdx: index("payment_intents_wallet_idx").on(table.walletAccountId),
  })
);

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    intentId: uuid("intent_id")
      .notNull()
      .references(() => paymentIntents.id, { onDelete: "cascade" }),
    connectorId: uuid("connector_id").references(() => paymentConnectors.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("pending"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    intentIdx: index("payment_attempts_intent_idx").on(table.intentId),
    connectorIdx: index("payment_attempts_connector_idx").on(table.connectorId),
  })
);

export const paymentEvents = pgTable(
  "payment_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => paymentAttempts.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    attemptIdx: index("payment_events_attempt_idx").on(table.attemptId),
  })
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash"),
    responsePayload: jsonb("response_payload"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => ({
    tenantKeyUnique: uniqueIndex("idempotency_keys_unique_key").on(
      table.tenantId,
      table.idempotencyKey
    ),
  })
);

export const customerEmbeddings = pgTable(
  "customer_embeddings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    customerUnique: uniqueIndex("customer_embeddings_customer_unique").on(
      table.tenantId,
      table.customerId
    ),
    tenantIdx: index("customer_embeddings_tenant_idx").on(table.tenantId),
    embeddingIdx: index("customer_embeddings_embedding_idx").using(
      "ivfflat",
      table.embedding
    ),
  })
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    name: text("name").notNull(),
    role: text("role").notNull().default("member"),
    avatarUrl: text("avatar_url"),
    profile: jsonb("profile")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tenantEmailUnique: uniqueIndex("users_tenant_email_unique").on(
      table.tenantId,
      table.email
    ),
    tenantIdx: index("users_tenant_idx").on(table.tenantId),
  })
);

export const badges = pgTable(
  "badges",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    icon: text("icon"),
    criteria: jsonb("criteria")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tenantSlugUnique: uniqueIndex("badges_tenant_slug_unique").on(
      table.tenantId,
      table.slug
    ),
    tenantIdx: index("badges_tenant_idx").on(table.tenantId),
  })
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    type: text("type").notNull(),
    category: text("category"),
    description: text("description"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tenantIdx: index("transactions_tenant_idx").on(table.tenantId),
    userIdx: index("transactions_user_idx").on(table.userId),
    occurredIdx: index("transactions_occurred_idx").on(table.occurredAt),
  })
);

export const rules = pgTable(
  "rules",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    trigger: text("trigger").notNull(),
    conditions: jsonb("conditions")
      .notNull()
      .default(sql`'{}'::jsonb`),
    actions: jsonb("actions")
      .notNull()
      .default(sql`'{}'::jsonb`),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tenantIdx: index("rules_tenant_idx").on(table.tenantId),
  })
);

export const challenges = pgTable(
  "challenges",
  {
    id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    metric: text("metric").notNull(),
    targetValue: numeric("target_value", { precision: 20, scale: 2 }).notNull(),
    window: text("window").notNull(),
    rewardBadgeId: uuid("reward_badge_id").references(() => badges.id, {
      onDelete: "set null",
    }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tenantSlugUnique: uniqueIndex("challenges_tenant_slug_unique").on(
      table.tenantId,
      table.slug
    ),
    tenantIdx: index("challenges_tenant_idx").on(table.tenantId),
    badgeIdx: index("challenges_badge_idx").on(table.rewardBadgeId),
  })
);

export const tenantsRelations = relations(tenants, ({ many }) => ({
  connectors: many(paymentConnectors),
  customers: many(customers),
  walletAccounts: many(walletAccounts),
  paymentIntents: many(paymentIntents),
  idempotencyKeys: many(idempotencyKeys),
  customerEmbeddings: many(customerEmbeddings),
  users: many(users),
  transactions: many(transactions),
  rules: many(rules),
  challenges: many(challenges),
  badges: many(badges),
}));

export const paymentConnectorsRelations = relations(
  paymentConnectors,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [paymentConnectors.tenantId],
      references: [tenants.id],
    }),
    paymentIntents: many(paymentIntents),
    paymentAttempts: many(paymentAttempts),
  })
);

export const customersRelations = relations(customers, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [customers.tenantId],
    references: [tenants.id],
  }),
  walletAccounts: many(walletAccounts),
  paymentIntents: many(paymentIntents),
  embeddings: many(customerEmbeddings),
}));

export const walletAccountsRelations = relations(
  walletAccounts,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [walletAccounts.tenantId],
      references: [tenants.id],
    }),
    customer: one(customers, {
      fields: [walletAccounts.customerId],
      references: [customers.id],
    }),
    paymentIntents: many(paymentIntents),
  })
);

export const paymentIntentsRelations = relations(
  paymentIntents,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [paymentIntents.tenantId],
      references: [tenants.id],
    }),
    walletAccount: one(walletAccounts, {
      fields: [paymentIntents.walletAccountId],
      references: [walletAccounts.id],
    }),
    customer: one(customers, {
      fields: [paymentIntents.customerId],
      references: [customers.id],
    }),
    connector: one(paymentConnectors, {
      fields: [paymentIntents.connectorId],
      references: [paymentConnectors.id],
    }),
    attempts: many(paymentAttempts),
  })
);

export const paymentAttemptsRelations = relations(
  paymentAttempts,
  ({ one, many }) => ({
    intent: one(paymentIntents, {
      fields: [paymentAttempts.intentId],
      references: [paymentIntents.id],
    }),
    connector: one(paymentConnectors, {
      fields: [paymentAttempts.connectorId],
      references: [paymentConnectors.id],
    }),
    events: many(paymentEvents),
  })
);

export const paymentEventsRelations = relations(
  paymentEvents,
  ({ one }) => ({
    attempt: one(paymentAttempts, {
      fields: [paymentEvents.attemptId],
      references: [paymentAttempts.id],
    }),
  })
);

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id],
  }),
  transactions: many(transactions),
  rules: many(rules),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  tenant: one(tenants, {
    fields: [transactions.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [transactions.userId],
    references: [users.id],
  }),
}));

export const rulesRelations = relations(rules, ({ one }) => ({
  tenant: one(tenants, {
    fields: [rules.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [rules.userId],
    references: [users.id],
  }),
}));

export const badgesRelations = relations(badges, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [badges.tenantId],
    references: [tenants.id],
  }),
  challenges: many(challenges),
}));

export const challengesRelations = relations(challenges, ({ one }) => ({
  tenant: one(tenants, {
    fields: [challenges.tenantId],
    references: [tenants.id],
  }),
  rewardBadge: one(badges, {
    fields: [challenges.rewardBadgeId],
    references: [badges.id],
  }),
}));

export const idempotencyKeysRelations = relations(idempotencyKeys, ({ one }) => ({
  tenant: one(tenants, {
    fields: [idempotencyKeys.tenantId],
    references: [tenants.id],
  }),
}));

export const customerEmbeddingsRelations = relations(
  customerEmbeddings,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [customerEmbeddings.tenantId],
      references: [tenants.id],
    }),
    customer: one(customers, {
      fields: [customerEmbeddings.customerId],
      references: [customers.id],
    }),
  })
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type PaymentIntent = typeof paymentIntents.$inferSelect;
export type NewPaymentIntent = typeof paymentIntents.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type TransactionRecord = typeof transactions.$inferSelect;
export type NewTransactionRecord = typeof transactions.$inferInsert;
export type Rule = typeof rules.$inferSelect;
export type NewRule = typeof rules.$inferInsert;
export type Badge = typeof badges.$inferSelect;
export type NewBadge = typeof badges.$inferInsert;
export type Challenge = typeof challenges.$inferSelect;
export type NewChallenge = typeof challenges.$inferInsert;
