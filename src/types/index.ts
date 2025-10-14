export type TransactionType =
  | 'income'
  | 'expense'
  | 'investment'
  | 'debt'
  | 'transfer';

export interface Transaction {
  id?: string;
  amount: number;
  type: TransactionType;
  category?: string;
  description?: string;
}

export interface FinancialGoals {
  savingsRate?: number;
  investmentRate?: number;
  debtToIncome?: number;
  expenseCapRatio?: number;
}

export interface BalanceSheet {
  cash?: number;
  investments?: number;
  debt?: number;
}

export interface KPIValue {
  key: string;
  label: string;
  value: number;
  unit?: 'currency' | 'ratio' | 'percentage';
  delta?: number;
  goal?: number;
}

export interface KPISet {
  [key: string]: KPIValue;
}

export interface MonthlyComputationInput {
  userId: string;
  month: string; // YYYY-MM format
  transactions: Transaction[];
  balances?: BalanceSheet;
  goals?: FinancialGoals;
  previous?: {
    month: string;
    netWorth?: number;
    kpis?: KPISet;
  };
}

export interface MonthlyInsight {
  id: string;
  userId: string;
  month: string;
  kpis: KPISet;
  story: string;
  createdAt: string;
}

export interface InsightRecord extends MonthlyInsight {}

export interface HealthScoreComponent {
  key: string;
  label: string;
  score: number;
  weight: number;
  message: string;
}

export interface HealthScoreResult {
  total: number;
  components: HealthScoreComponent[];
  notes: string[];
}

export interface SuggestedAction {
  id: string;
  title: string;
  description: string;
  category: 'income' | 'expense' | 'debt' | 'investment' | 'savings';
  rationale: string;
  expectedImpact: string;
}

export interface SimulationResult {
  projectedInsight: MonthlyInsight;
  projectedHealth: HealthScoreResult;
  adjustments: Record<string, number>;
}
