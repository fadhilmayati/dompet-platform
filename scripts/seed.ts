import "dotenv/config";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  badges,
  challenges,
  rules,
  tenants,
  transactions,
  users,
} from "../drizzle/schema";

const connectionString =
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.POSTGRES_URL ??
  process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "Missing database connection string. Set POSTGRES_URL_NON_POOLING, POSTGRES_URL, or DATABASE_URL.",
  );
}

const TENANT_SLUG = "dompet-demo";

const badgeSeed = [
  {
    slug: "savings-hero",
    name: "Savings Hero",
    description: "Saved consistently above 20% of income for the month.",
    icon: "💰",
    criteria: { metric: "savings_rate", threshold: 0.2 },
  },
  {
    slug: "debt-slayer",
    name: "Debt Slayer",
    description: "Reduced revolving debt by at least 5% within a quarter.",
    icon: "⚔️",
    criteria: { metric: "debt_reduction", threshold: 0.05 },
  },
  {
    slug: "budget-master",
    name: "Budget Master",
    description: "Kept discretionary spending under 60% of income for a month.",
    icon: "📊",
    criteria: { metric: "expense_ratio", ceiling: 0.6 },
  },
];

const userSeed = [
  {
    name: "Ayu Hartati",
    email: "ayu@dompet.id",
    role: "member",
    avatarUrl: "https://avatars.dicebear.com/api/initials/AH.svg",
    profile: {
      city: "Jakarta",
      goals: ["Build emergency fund", "Save 20% of income"],
      preferredLanguage: "id",
    },
  },
  {
    name: "Rahmat Wijaya",
    email: "rahmat@dompet.id",
    role: "member",
    avatarUrl: "https://avatars.dicebear.com/api/initials/RW.svg",
    profile: {
      city: "Bandung",
      goals: ["Eliminate credit card debt"],
      preferredLanguage: "id",
    },
  },
  {
    name: "Siti Lestari",
    email: "siti@dompet.id",
    role: "member",
    avatarUrl: "https://avatars.dicebear.com/api/initials/SL.svg",
    profile: {
      city: "Surabaya",
      goals: ["Invest 15% of income"],
      preferredLanguage: "id",
    },
  },
];

const ruleSeed = [
  {
    name: "Round-up savings automation",
    description: "Round every expense to the nearest 10k and send the remainder to savings.",
    trigger: "transaction.created",
    conditions: { type: "expense", minimum: 100000 },
    actions: { type: "transfer", destination: "savings", ratio: 0.05 },
    isActive: true,
  },
  {
    name: "Debt snowball reminder",
    description: "Ping the user when debt-to-income stays above 40% at month end.",
    trigger: "month.closed",
    conditions: { metric: "debt_to_income", threshold: 0.4 },
    actions: { type: "notify", channel: "email", template: "debt-snowball" },
    userEmail: "rahmat@dompet.id",
    isActive: true,
  },
  {
    name: "Investment payday boost",
    description: "Increase investment transfer by IDR 500k whenever salary is detected.",
    trigger: "transaction.categorised",
    conditions: { category: "salary" },
    actions: { type: "transfer", destination: "investments", amount: 500000 },
    userEmail: "siti@dompet.id",
    isActive: true,
  },
];

const challengeSeed = [
  {
    slug: "save-one-million",
    title: "Save IDR 1,000,000 this month",
    description: "Automate an extra savings transfer and keep dining expenses in check.",
    metric: "savings_amount",
    targetValue: 1_000_000,
    window: "monthly",
    rewardBadgeSlug: "savings-hero",
    startsAt: new Date("2024-05-01T00:00:00Z"),
    endsAt: new Date("2024-05-31T23:59:59Z"),
    metadata: { tips: ["Set a mid-month reminder", "Freeze impulse buys"] },
  },
  {
    slug: "no-takeout-week",
    title: "No Takeout Week",
    description: "Cook at home for seven days to trim dining expenses.",
    metric: "dining_expense",
    targetValue: 0,
    window: "weekly",
    rewardBadgeSlug: "budget-master",
    startsAt: new Date("2024-05-06T00:00:00Z"),
    endsAt: new Date("2024-05-12T23:59:59Z"),
    metadata: { focusCategory: "dining" },
  },
  {
    slug: "debt-free-quest",
    title: "Debt Free Quest",
    description: "Pay down 5% of revolving debt this quarter.",
    metric: "debt_reduction",
    targetValue: 0.05,
    window: "quarterly",
    rewardBadgeSlug: "debt-slayer",
    startsAt: new Date("2024-04-01T00:00:00Z"),
    endsAt: new Date("2024-06-30T23:59:59Z"),
    metadata: { focus: "credit_card" },
  },
];

const transactionSeed = [
  {
    userEmail: "ayu@dompet.id",
    amount: 15000000,
    currency: "IDR",
    type: "income",
    category: "salary",
    description: "Monthly salary from PT Nusantara",
    occurredAt: new Date("2024-05-01T02:00:00Z"),
    metadata: { employer: "PT Nusantara", channel: "bank_transfer" },
  },
  {
    userEmail: "ayu@dompet.id",
    amount: 850000,
    currency: "IDR",
    type: "expense",
    category: "groceries",
    description: "Weekly groceries at Hypermart",
    occurredAt: new Date("2024-05-05T04:30:00Z"),
    metadata: { merchant: "Hypermart", paymentMethod: "debit" },
  },
  {
    userEmail: "ayu@dompet.id",
    amount: 500000,
    currency: "IDR",
    type: "investment",
    category: "mutual_funds",
    description: "Automatic mutual fund contribution",
    occurredAt: new Date("2024-05-10T01:15:00Z"),
    metadata: { provider: "Bibit" },
  },
  {
    userEmail: "rahmat@dompet.id",
    amount: 12500000,
    currency: "IDR",
    type: "income",
    category: "salary",
    description: "Salary deposit",
    occurredAt: new Date("2024-05-01T03:15:00Z"),
    metadata: { employer: "PT Finansia" },
  },
  {
    userEmail: "rahmat@dompet.id",
    amount: 1500000,
    currency: "IDR",
    type: "expense",
    category: "debt_payment",
    description: "Credit card repayment",
    occurredAt: new Date("2024-05-07T07:45:00Z"),
    metadata: { lender: "Bank Mandiri", accountEnding: "4321" },
  },
  {
    userEmail: "rahmat@dompet.id",
    amount: 350000,
    currency: "IDR",
    type: "expense",
    category: "dining",
    description: "Dinner with family",
    occurredAt: new Date("2024-05-11T12:30:00Z"),
    metadata: { merchant: "Sate Senayan" },
  },
  {
    userEmail: "siti@dompet.id",
    amount: 11000000,
    currency: "IDR",
    type: "income",
    category: "salary",
    description: "Monthly salary",
    occurredAt: new Date("2024-05-01T01:30:00Z"),
    metadata: { employer: "PT Digital" },
  },
  {
    userEmail: "siti@dompet.id",
    amount: 400000,
    currency: "IDR",
    type: "expense",
    category: "transport",
    description: "Fuel for car",
    occurredAt: new Date("2024-05-04T06:50:00Z"),
    metadata: { merchant: "Pertamina" },
  },
  {
    userEmail: "siti@dompet.id",
    amount: 750000,
    currency: "IDR",
    type: "investment",
    category: "stocks",
    description: "Stock purchase via Bareksa",
    occurredAt: new Date("2024-05-09T09:40:00Z"),
    metadata: { platform: "Bareksa" },
  },
];

async function main(): Promise<void> {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  try {
    const summary = await db.transaction(async (tx) => {
      await tx.delete(tenants).where(eq(tenants.slug, TENANT_SLUG));

      const [tenant] = await tx
        .insert(tenants)
        .values({
          slug: TENANT_SLUG,
          name: "Dompet Demo Tenant",
          description: "Seed data for MCP tool demonstrations and regression tests.",
          metadata: { region: "id", tier: "demo" },
        })
        .returning({ id: tenants.id });

      const insertedUsers = await tx
        .insert(users)
        .values(
          userSeed.map((user) => ({
            tenantId: tenant.id,
            name: user.name,
            email: user.email,
            role: user.role,
            avatarUrl: user.avatarUrl,
            profile: user.profile,
          })),
        )
        .returning({ id: users.id, email: users.email });

      const userIdByEmail = new Map(insertedUsers.map((entry) => [entry.email, entry.id]));

      const insertedBadges = await tx
        .insert(badges)
        .values(
          badgeSeed.map((badge) => ({
            tenantId: tenant.id,
            slug: badge.slug,
            name: badge.name,
            description: badge.description,
            icon: badge.icon,
            criteria: badge.criteria,
          })),
        )
        .returning({ id: badges.id, slug: badges.slug });

      const badgeIdBySlug = new Map(insertedBadges.map((entry) => [entry.slug, entry.id]));

      await tx.insert(rules).values(
        ruleSeed.map((rule) => ({
          tenantId: tenant.id,
          userId: rule.userEmail ? userIdByEmail.get(rule.userEmail) ?? null : null,
          name: rule.name,
          description: rule.description,
          trigger: rule.trigger,
          conditions: rule.conditions,
          actions: rule.actions,
          isActive: rule.isActive ?? true,
        })),
      );

      await tx.insert(challenges).values(
        challengeSeed.map((challenge) => ({
          tenantId: tenant.id,
          slug: challenge.slug,
          title: challenge.title,
          description: challenge.description,
          metric: challenge.metric,
          targetValue: challenge.targetValue.toString(),
          window: challenge.window,
          rewardBadgeId: challenge.rewardBadgeSlug
            ? badgeIdBySlug.get(challenge.rewardBadgeSlug) ?? null
            : null,
          startsAt: challenge.startsAt,
          endsAt: challenge.endsAt,
          metadata: challenge.metadata ?? {},
        })),
      );

      await tx.insert(transactions).values(
        transactionSeed.map((transaction) => {
          const userId = userIdByEmail.get(transaction.userEmail);
          if (!userId) {
            throw new Error(`Missing seeded user for ${transaction.userEmail}`);
          }
          return {
            tenantId: tenant.id,
            userId,
            amount: transaction.amount.toFixed(2),
            currency: transaction.currency,
            type: transaction.type,
            category: transaction.category ?? null,
            description: transaction.description ?? null,
            occurredAt: transaction.occurredAt,
            metadata: transaction.metadata ?? {},
          };
        }),
      );

      return {
        tenantId: tenant.id,
        users: insertedUsers.length,
        badges: insertedBadges.length,
        rules: ruleSeed.length,
        challenges: challengeSeed.length,
        transactions: transactionSeed.length,
      };
    });

    console.log("✅ Demo data seeded successfully:", summary);
  } catch (error) {
    console.error("❌ Failed to seed demo data:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("❌ Unexpected error while seeding:", error);
  process.exit(1);
});
