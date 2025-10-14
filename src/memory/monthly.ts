import { upsertInsight } from '../storage/insights';
import { upsertEmbedding } from '../services/embeddings';
import {
  MonthlyComputationInput,
  MonthlyInsight,
  KPISet,
  KPIValue,
  Transaction,
} from '../types';

function sum(transactions: Transaction[], type: Transaction['type']): number {
  return transactions
    .filter((transaction) => transaction.type === type)
    .reduce((total, transaction) => total + Math.abs(transaction.amount), 0);
}

function safeRatio(numerator: number, denominator: number): number {
  if (!denominator) {
    return 0;
  }
  return numerator / denominator;
}

function formatCurrency(value: number): string {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
  return formatter.format(Math.round(value));
}

function formatPercentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function buildKpi(
  key: string,
  label: string,
  value: number,
  unit: KPIValue['unit'],
  extras: Partial<KPIValue> = {},
): KPIValue {
  return {
    key,
    label,
    value,
    unit,
    ...extras,
  };
}

export function craftMonthlyStory(month: string, kpis: KPISet): string {
  const income = kpis.income?.value ?? 0;
  const expenses = kpis.expenses?.value ?? 0;
  const cashFlow = kpis.cashFlow?.value ?? 0;
  const savingsRate = kpis.savingsRate?.value ?? 0;
  const investmentRate = kpis.investmentRate?.value ?? 0;
  const debtToIncome = kpis.debtToIncome?.value ?? 0;
  const netWorth = kpis.netWorth?.value ?? 0;
  const delta = kpis.netWorth?.delta ?? 0;
  const leadingExpense = kpis.topExpenseCategory?.label ?? 'spending';
  const expenseShare = kpis.topExpenseCategory?.value ?? 0;

  const baseSentences = [
    `In ${month}, income reached ${formatCurrency(income)} while expenses were ${formatCurrency(expenses)}, leaving net cash flow of ${formatCurrency(cashFlow)}.`,
    `You saved ${formatPercentage(savingsRate)} of income, invested ${formatPercentage(
      investmentRate,
    )}, and carried a debt-to-income ratio of ${formatPercentage(debtToIncome)}.`,
    `Net worth closed at ${formatCurrency(netWorth)}${
      delta ? `, a ${delta > 0 ? 'gain' : 'dip'} of ${formatCurrency(Math.abs(delta))}` : ''
    }, with ${leadingExpense} taking ${formatPercentage(expenseShare)} of spending.`,
  ];

  let story = baseSentences.join(' ');

  if (story.length < 200) {
    const expenseRatio = kpis.expenseRatio?.value ?? 0;
    story += ` Expense ratio sat at ${formatPercentage(
      expenseRatio,
    )}, keeping progress ${expenseRatio <= 0.5 ? 'ahead of plan' : 'within reach'}.`;
  }

  if (story.length < 200) {
    story += ' Continued focus on mindful spending will compound the month’s momentum.';
  }

  if (story.length > 400) {
    story = `${story.slice(0, 397)}...`;
  }

  if (story.length < 200) {
    story = story.padEnd(200, '.');
  }

  return story;
}

function deriveTopExpenseCategory(transactions: Transaction[]): { label: string; value: number } {
  const expenseTotals = transactions
    .filter((transaction) => transaction.type === 'expense')
    .reduce<Record<string, number>>((accumulator, transaction) => {
      if (!transaction.category) {
        return accumulator;
      }
      accumulator[transaction.category] =
        (accumulator[transaction.category] ?? 0) + Math.abs(transaction.amount);
      return accumulator;
    }, {});

  const totalExpenses = Object.values(expenseTotals).reduce((total, value) => total + value, 0);

  let leader: { label: string; value: number } | null = null;
  for (const [category, value] of Object.entries(expenseTotals)) {
    if (!leader || value > leader.value) {
      leader = { label: category, value };
    }
  }

  if (!leader || !totalExpenses) {
    return { label: 'general expenses', value: 0 };
  }

  return { label: leader.label, value: safeRatio(leader.value, totalExpenses) };
}

export function computeMonthlyMemory(input: MonthlyComputationInput): MonthlyInsight {
  const { month, userId, transactions, balances, goals, previous } = input;

  const totalIncome = sum(transactions, 'income');
  const totalExpenses = sum(transactions, 'expense');
  const totalInvestments = sum(transactions, 'investment');
  const totalDebtPayments = sum(transactions, 'debt');

  const netCashFlow = totalIncome - totalExpenses - totalInvestments - totalDebtPayments;
  const savingsRate = totalIncome > 0 ? clamp((totalIncome - totalExpenses) / totalIncome, 0, 1.5) : 0;
  const investmentRate = totalIncome > 0 ? clamp(totalInvestments / totalIncome, 0, 1.5) : 0;
  const debtOutstanding = balances?.debt ?? 0;
  const debtToIncome = totalIncome > 0 ? clamp(debtOutstanding / totalIncome, 0, 2) : 0;
  const expenseRatio = totalIncome > 0 ? clamp(totalExpenses / totalIncome, 0, 2) : 0;

  const netWorth = (balances?.cash ?? 0) + (balances?.investments ?? 0) - debtOutstanding;
  const previousNetWorth = previous?.netWorth ?? null;
  const netWorthDelta = previousNetWorth !== null ? netWorth - previousNetWorth : undefined;

  const topExpenseCategory = deriveTopExpenseCategory(transactions);

  const kpis: KPISet = {
    income: buildKpi('income', 'Total income', totalIncome, 'currency'),
    expenses: buildKpi('expenses', 'Total expenses', totalExpenses, 'currency'),
    investments: buildKpi('investments', 'Investment contributions', totalInvestments, 'currency'),
    debtPayments: buildKpi('debtPayments', 'Debt payments', totalDebtPayments, 'currency'),
    cashFlow: buildKpi('cashFlow', 'Net cash flow', netCashFlow, 'currency'),
    savingsRate: buildKpi('savingsRate', 'Savings rate', savingsRate, 'ratio', {
      goal: goals?.savingsRate,
    }),
    investmentRate: buildKpi('investmentRate', 'Investment rate', investmentRate, 'ratio', {
      goal: goals?.investmentRate,
    }),
    debtToIncome: buildKpi('debtToIncome', 'Debt-to-income', debtToIncome, 'ratio', {
      goal: goals?.debtToIncome,
    }),
    expenseRatio: buildKpi('expenseRatio', 'Expense ratio', expenseRatio, 'ratio', {
      goal: goals?.expenseCapRatio,
    }),
    debtOutstanding: buildKpi('debtOutstanding', 'Debt outstanding', debtOutstanding, 'currency'),
    netWorth: buildKpi('netWorth', 'Net worth', netWorth, 'currency', {
      delta: netWorthDelta,
    }),
    topExpenseCategory: buildKpi(
      'topExpenseCategory',
      topExpenseCategory.label,
      topExpenseCategory.value,
      'percentage',
    ),
  };

  if (typeof netWorthDelta === 'number') {
    kpis.netWorth.delta = netWorthDelta;
  }

  const story = craftMonthlyStory(month, kpis);

  const insight: MonthlyInsight = {
    id: `${userId}:${month}`,
    userId,
    month,
    kpis,
    story,
    createdAt: new Date().toISOString(),
  };

  upsertInsight(insight);

  const incomeScale = Math.max(totalIncome, totalExpenses, Math.abs(netCashFlow), 1);
  const embeddingVector = [
    clamp(totalIncome / incomeScale, -1, 1),
    clamp(totalExpenses / incomeScale, -1, 1),
    clamp(netCashFlow / incomeScale, -1, 1),
    clamp(savingsRate, 0, 1),
    clamp(investmentRate, 0, 1),
    clamp(debtToIncome, 0, 1),
    clamp(expenseRatio, 0, 1),
  ];

  upsertEmbedding(insight.id, embeddingVector, {
    userId,
    month,
    kpis: Object.keys(kpis),
  });

  return insight;
}
