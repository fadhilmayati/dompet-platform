import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import {
  badges,
  challenges,
  rules,
  tenants,
  transactions,
  users,
} from "../../drizzle/schema";

export interface ToolRunResult<T> {
  ok: boolean;
  data?: T;
  message?: string;
}

export interface ResolvedTool<TResult = unknown> {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  run(input: unknown): Promise<ToolRunResult<TResult>>;
}

async function resolveTenantId(
  db: NodePgDatabase,
  slug: string,
): Promise<string | null> {
  const [record] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  return record?.id ?? null;
}

async function resolveUserById(
  db: NodePgDatabase,
  tenantId: string,
  userId: string,
): Promise<{ id: string; email: string; name: string } | null> {
  const [record] = await db
    .select({ id: users.id, tenantId: users.tenantId, email: users.email, name: users.name })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
    .limit(1);
  if (!record) {
    return null;
  }
  return { id: record.id, email: record.email, name: record.name };
}

async function resolveUserByEmail(
  db: NodePgDatabase,
  tenantId: string,
  email: string,
): Promise<{ id: string; email: string; name: string } | null> {
  const [record] = await db
    .select({ id: users.id, tenantId: users.tenantId, email: users.email, name: users.name })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.email, email)))
    .limit(1);
  if (!record) {
    return null;
  }
  return { id: record.id, email: record.email, name: record.name };
}

function toAndChain(conditions: ReturnType<typeof eq>[]): ReturnType<typeof eq> {
  let current = conditions[0];
  for (let i = 1; i < conditions.length; i += 1) {
    current = and(current, conditions[i]);
  }
  return current;
}

export function createMcpTools(db: NodePgDatabase): ResolvedTool[] {
  const tools: ResolvedTool[] = [];

  const listUsersSchema = z.object({
    tenantSlug: z.string().min(1, "Tenant slug is required"),
    limit: z.number().int().min(1).max(50).optional(),
  });

  tools.push({
    name: "users.list",
    description: "List users for a tenant, including role and profile metadata.",
    schema: listUsersSchema,
    async run(rawInput) {
      const input = listUsersSchema.parse(rawInput);
      const tenantId = await resolveTenantId(db, input.tenantSlug);
      if (!tenantId) {
        return { ok: false, message: `Tenant ${input.tenantSlug} not found` };
      }
      const rows = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          avatarUrl: users.avatarUrl,
          profile: users.profile,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.tenantId, tenantId))
        .orderBy(asc(users.createdAt))
        .limit(input.limit ?? 20);
      return { ok: true, data: rows };
    },
  });

  const listTransactionsSchema = z.object({
    tenantSlug: z.string().min(1),
    userEmail: z.string().email().optional(),
    userId: z.string().uuid().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  });

  tools.push({
    name: "transactions.list",
    description: "Retrieve transactions for a tenant or a specific user with optional date filtering.",
    schema: listTransactionsSchema,
    async run(rawInput) {
      const input = listTransactionsSchema.parse(rawInput);
      const tenantId = await resolveTenantId(db, input.tenantSlug);
      if (!tenantId) {
        return { ok: false, message: `Tenant ${input.tenantSlug} not found` };
      }

      let userId: string | undefined;
      if (input.userId) {
        const user = await resolveUserById(db, tenantId, input.userId);
        if (!user) {
          return { ok: false, message: `User ${input.userId} not found for tenant` };
        }
        userId = user.id;
      } else if (input.userEmail) {
        const user = await resolveUserByEmail(db, tenantId, input.userEmail);
        if (!user) {
          return { ok: false, message: `User ${input.userEmail} not found for tenant` };
        }
        userId = user.id;
      }

      const conditions: ReturnType<typeof eq>[] = [eq(transactions.tenantId, tenantId)];
      if (userId) {
        conditions.push(eq(transactions.userId, userId));
      }
      if (input.from) {
        conditions.push(gte(transactions.occurredAt, input.from));
      }
      if (input.to) {
        conditions.push(lte(transactions.occurredAt, input.to));
      }
      const whereClause = toAndChain(conditions);

      const rows = await db
        .select({
          id: transactions.id,
          userId: transactions.userId,
          tenantId: transactions.tenantId,
          amount: transactions.amount,
          currency: transactions.currency,
          type: transactions.type,
          category: transactions.category,
          description: transactions.description,
          occurredAt: transactions.occurredAt,
          metadata: transactions.metadata,
          createdAt: transactions.createdAt,
        })
        .from(transactions)
        .where(whereClause)
        .orderBy(desc(transactions.occurredAt))
        .limit(input.limit ?? 50);

      return { ok: true, data: rows };
    },
  });

  const createTransactionSchema = z
    .object({
      tenantSlug: z.string().min(1),
      userEmail: z.string().email().optional(),
      userId: z.string().uuid().optional(),
      amount: z.number(),
      currency: z.string().min(3).max(3),
      type: z.enum(["income", "expense", "investment", "debt", "transfer"]),
      category: z.string().optional(),
      description: z.string().optional(),
      occurredAt: z.coerce.date(),
      metadata: z.record(z.any()).optional(),
    })
    .refine((value) => value.userEmail || value.userId, {
      message: "Either userEmail or userId must be supplied",
      path: ["userEmail"],
    });

  tools.push({
    name: "transactions.create",
    description: "Create a transaction for a user within the specified tenant.",
    schema: createTransactionSchema,
    async run(rawInput) {
      const input = createTransactionSchema.parse(rawInput);
      const tenantId = await resolveTenantId(db, input.tenantSlug);
      if (!tenantId) {
        return { ok: false, message: `Tenant ${input.tenantSlug} not found` };
      }

      let user;
      if (input.userId) {
        user = await resolveUserById(db, tenantId, input.userId);
      } else if (input.userEmail) {
        user = await resolveUserByEmail(db, tenantId, input.userEmail);
      }
      if (!user) {
        return {
          ok: false,
          message: `Unable to resolve user for tenant ${input.tenantSlug}`,
        };
      }

      const [record] = await db
        .insert(transactions)
        .values({
          tenantId,
          userId: user.id,
          amount: input.amount.toFixed(2),
          currency: input.currency.toUpperCase(),
          type: input.type,
          category: input.category ?? null,
          description: input.description ?? null,
          occurredAt: input.occurredAt,
          metadata: input.metadata ?? {},
        })
        .returning({
          id: transactions.id,
          tenantId: transactions.tenantId,
          userId: transactions.userId,
          amount: transactions.amount,
          currency: transactions.currency,
          type: transactions.type,
          category: transactions.category,
          description: transactions.description,
          occurredAt: transactions.occurredAt,
          metadata: transactions.metadata,
          createdAt: transactions.createdAt,
        });

      return { ok: true, data: record };
    },
  });

  const listRulesSchema = z.object({
    tenantSlug: z.string().min(1),
    activeOnly: z.boolean().optional(),
    userEmail: z.string().email().optional(),
    userId: z.string().uuid().optional(),
  });

  tools.push({
    name: "rules.list",
    description: "List automation rules defined for a tenant, optionally filtered by user.",
    schema: listRulesSchema,
    async run(rawInput) {
      const input = listRulesSchema.parse(rawInput);
      const tenantId = await resolveTenantId(db, input.tenantSlug);
      if (!tenantId) {
        return { ok: false, message: `Tenant ${input.tenantSlug} not found` };
      }

      let userId: string | undefined;
      if (input.userId) {
        const user = await resolveUserById(db, tenantId, input.userId);
        if (!user) {
          return { ok: false, message: `User ${input.userId} not found for tenant` };
        }
        userId = user.id;
      } else if (input.userEmail) {
        const user = await resolveUserByEmail(db, tenantId, input.userEmail);
        if (!user) {
          return { ok: false, message: `User ${input.userEmail} not found for tenant` };
        }
        userId = user.id;
      }

      const conditions: ReturnType<typeof eq>[] = [eq(rules.tenantId, tenantId)];
      if (typeof input.activeOnly === "boolean") {
        conditions.push(eq(rules.isActive, input.activeOnly));
      }
      if (userId) {
        conditions.push(eq(rules.userId, userId));
      }
      const whereClause = toAndChain(conditions);

      const rows = await db
        .select({
          id: rules.id,
          name: rules.name,
          description: rules.description,
          trigger: rules.trigger,
          conditions: rules.conditions,
          actions: rules.actions,
          isActive: rules.isActive,
          userId: rules.userId,
          createdAt: rules.createdAt,
        })
        .from(rules)
        .where(whereClause)
        .orderBy(asc(rules.createdAt));

      return { ok: true, data: rows };
    },
  });

  const listChallengesSchema = z.object({
    tenantSlug: z.string().min(1),
    activeOnly: z.boolean().optional(),
    now: z.coerce.date().optional(),
  });

  tools.push({
    name: "challenges.list",
    description: "Return gamified challenges for a tenant including badge rewards.",
    schema: listChallengesSchema,
    async run(rawInput) {
      const input = listChallengesSchema.parse(rawInput);
      const tenantId = await resolveTenantId(db, input.tenantSlug);
      if (!tenantId) {
        return { ok: false, message: `Tenant ${input.tenantSlug} not found` };
      }

      const referenceDate = input.now ?? new Date();
      const conditions: ReturnType<typeof eq>[] = [eq(challenges.tenantId, tenantId)];
      if (input.activeOnly) {
        conditions.push(lte(challenges.startsAt, referenceDate));
        conditions.push(gte(challenges.endsAt, referenceDate));
      }
      const whereClause = toAndChain(conditions);

      const rows = await db
        .select({
          id: challenges.id,
          slug: challenges.slug,
          title: challenges.title,
          description: challenges.description,
          metric: challenges.metric,
          targetValue: challenges.targetValue,
          window: challenges.window,
          startsAt: challenges.startsAt,
          endsAt: challenges.endsAt,
          metadata: challenges.metadata,
          badgeId: badges.id,
          badgeSlug: badges.slug,
          badgeName: badges.name,
          badgeIcon: badges.icon,
        })
        .from(challenges)
        .leftJoin(badges, eq(challenges.rewardBadgeId, badges.id))
        .where(whereClause)
        .orderBy(asc(challenges.startsAt));

      const data = rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        metric: row.metric,
        targetValue: row.targetValue,
        window: row.window,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        metadata: row.metadata,
        rewardBadge: row.badgeId
          ? {
              id: row.badgeId,
              slug: row.badgeSlug,
              name: row.badgeName,
              icon: row.badgeIcon,
            }
          : null,
      }));

      return { ok: true, data };
    },
  });

  const listBadgesSchema = z.object({
    tenantSlug: z.string().min(1),
    limit: z.number().int().min(1).max(50).optional(),
  });

  tools.push({
    name: "badges.list",
    description: "List the available badges for a tenant.",
    schema: listBadgesSchema,
    async run(rawInput) {
      const input = listBadgesSchema.parse(rawInput);
      const tenantId = await resolveTenantId(db, input.tenantSlug);
      if (!tenantId) {
        return { ok: false, message: `Tenant ${input.tenantSlug} not found` };
      }

      const rows = await db
        .select({
          id: badges.id,
          slug: badges.slug,
          name: badges.name,
          description: badges.description,
          icon: badges.icon,
          criteria: badges.criteria,
          createdAt: badges.createdAt,
        })
        .from(badges)
        .where(eq(badges.tenantId, tenantId))
        .orderBy(asc(badges.createdAt))
        .limit(input.limit ?? 20);

      return { ok: true, data: rows };
    },
  });

  return tools;
}
