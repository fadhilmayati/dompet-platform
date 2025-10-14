import { HealthScoreComponent, HealthScoreResult, KPISet } from '../types';

const KPI_WEIGHTS: Record<string, number> = {
  cashFlow: 0.35,
  savingsRate: 0.25,
  debtToIncome: 0.2,
  investmentRate: 0.2,
};

const KPI_LABELS: Record<string, string> = {
  cashFlow: 'Cash flow quality',
  savingsRate: 'Savings discipline',
  debtToIncome: 'Debt load',
  investmentRate: 'Future planning',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function scoreCashFlow(kpis: KPISet): number {
  const income = kpis.income?.value ?? 0;
  const cashFlow = kpis.cashFlow?.value ?? 0;
  if (income <= 0) {
    return 0.5;
  }
  const ratio = cashFlow / income;
  return clamp((ratio + 1) / 2, 0, 1);
}

function scoreSavings(kpis: KPISet): number {
  const savingsRate = kpis.savingsRate?.value ?? 0;
  return clamp(savingsRate, 0, 1);
}

function scoreInvestment(kpis: KPISet): number {
  const investmentRate = kpis.investmentRate?.value ?? 0;
  return clamp(investmentRate / 0.3, 0, 1);
}

function scoreDebt(kpis: KPISet): number {
  const debtRatio = kpis.debtToIncome?.value ?? 0;
  if (debtRatio <= 0) {
    return 1;
  }
  return clamp(1 - debtRatio, 0, 1);
}

function componentMessage(key: string, score: number, kpis: KPISet): string {
  switch (key) {
    case 'cashFlow': {
      const cashFlow = kpis.cashFlow?.value ?? 0;
      const income = kpis.income?.value ?? 0;
      if (score >= 0.75) {
        return `Cash flow is resilient with ${cashFlow.toFixed(0)} retained from ${income.toFixed(0)} of income.`;
      }
      if (score >= 0.5) {
        return `Cash flow is stable but could be improved; ${cashFlow.toFixed(0)} remains after essentials.`;
      }
      return 'Cash flow is tight; consider trimming variable costs or boosting income.';
    }
    case 'savingsRate': {
      const savingsRate = kpis.savingsRate?.value ?? 0;
      if (score >= 0.75) {
        return `Savings rate at ${Math.round(savingsRate * 100)}% keeps you ahead of goals.`;
      }
      if (score >= 0.5) {
        return `Savings rate of ${Math.round(savingsRate * 100)}% meets minimum targets.`;
      }
      return 'Savings rate trails expectations; redirect part of surplus cash flow to savings.';
    }
    case 'debtToIncome': {
      const debtRatio = kpis.debtToIncome?.value ?? 0;
      if (score >= 0.75) {
        return `Debt-to-income at ${Math.round(debtRatio * 100)}% is comfortably low.`;
      }
      if (score >= 0.5) {
        return `Debt-to-income near ${Math.round(debtRatio * 100)}% is manageable but worth watching.`;
      }
      return 'Debt load weighs on income; prioritise repayments to regain flexibility.';
    }
    case 'investmentRate': {
      const investmentRate = kpis.investmentRate?.value ?? 0;
      if (score >= 0.75) {
        return `Investment contributions of ${Math.round(investmentRate * 100)}% support future growth.`;
      }
      if (score >= 0.5) {
        return `Investment rate of ${Math.round(investmentRate * 100)}% keeps momentum but has room to grow.`;
      }
      return 'Investment pace is light; allocate a fixed monthly contribution to long-term assets.';
    }
    default:
      return 'KPI review complete.';
  }
}

function buildComponent(key: string, score: number, kpis: KPISet): HealthScoreComponent {
  const weight = KPI_WEIGHTS[key];
  const label = KPI_LABELS[key];
  return {
    key,
    label,
    score: Number(score.toFixed(3)),
    weight,
    message: componentMessage(key, score, kpis),
  };
}

function deriveNotes(components: HealthScoreComponent[], kpis: KPISet): string[] {
  const notes: string[] = [];
  const savingsGoal = kpis.savingsRate?.goal;
  if (typeof savingsGoal === 'number' && (kpis.savingsRate?.value ?? 0) < savingsGoal) {
    notes.push(`Savings rate trails the ${Math.round(savingsGoal * 100)}% goal.`);
  }
  const investmentGoal = kpis.investmentRate?.goal;
  if (typeof investmentGoal === 'number' && (kpis.investmentRate?.value ?? 0) < investmentGoal) {
    notes.push(`Investment contributions lag the ${Math.round(investmentGoal * 100)}% target.`);
  }
  const debtGoal = kpis.debtToIncome?.goal;
  if (typeof debtGoal === 'number' && (kpis.debtToIncome?.value ?? 0) > debtGoal) {
    notes.push(`Debt-to-income exceeds the ${Math.round(debtGoal * 100)}% ceiling.`);
  }

  if (!notes.length) {
    const weakest = [...components].sort((a, b) => a.score - b.score)[0];
    if (weakest) {
      notes.push(`Focus on ${weakest.label.toLowerCase()} to unlock more points.`);
    }
  }

  return notes;
}

export function scoreFinancialHealth(kpis: KPISet): HealthScoreResult {
  const scoreMap: Record<string, number> = {
    cashFlow: scoreCashFlow(kpis),
    savingsRate: scoreSavings(kpis),
    debtToIncome: scoreDebt(kpis),
    investmentRate: scoreInvestment(kpis),
  };

  const components = Object.entries(scoreMap).map(([key, score]) => buildComponent(key, score, kpis));
  const total = Number(
    components.reduce((aggregate, component) => aggregate + component.score * component.weight, 0).toFixed(3),
  );

  const notes = deriveNotes(components, kpis);

  return {
    total,
    components,
    notes,
  };
}
