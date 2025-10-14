import { HealthScoreResult, MonthlyInsight, SuggestedAction } from '../types';

function hasAction(actions: SuggestedAction[], id: string): boolean {
  return actions.some((action) => action.id === id);
}

function formatPercent(value: number | undefined): string {
  if (value === undefined) {
    return '0%';
  }
  return `${Math.round(value * 100)}%`;
}

export function suggestActions(
  insight: MonthlyInsight,
  health: HealthScoreResult,
): SuggestedAction[] {
  const actions: SuggestedAction[] = [];
  const kpis = insight.kpis;

  const savingsRate = kpis.savingsRate?.value ?? 0;
  const savingsGoal = kpis.savingsRate?.goal ?? 0.2;
  if (savingsRate < savingsGoal && !hasAction(actions, 'improve-savings')) {
    actions.push({
      id: 'improve-savings',
      title: 'Automate an extra savings transfer',
      description: 'Schedule a mid-month auto-transfer to route part of your surplus into savings before it is spent.',
      category: 'savings',
      rationale: `Savings rate ${formatPercent(savingsRate)} is below the ${formatPercent(savingsGoal)} goal.`,
      expectedImpact: 'Raises savings rate by ~3 percentage points and boosts net cash flow.',
    });
  }

  const expenseRatio = kpis.expenseRatio?.value ?? 0;
  const expenseGoal = kpis.expenseRatio?.goal ?? 0.5;
  if (expenseRatio > expenseGoal && !hasAction(actions, 'optimize-expenses')) {
    actions.push({
      id: 'optimize-expenses',
      title: 'Cap discretionary spending buckets',
      description: 'Set weekly limits on dining, shopping, and entertainment to bring overall expenses back toward plan.',
      category: 'expense',
      rationale: `Expenses consume ${formatPercent(expenseRatio)} of income versus ${formatPercent(expenseGoal)} target.`,
      expectedImpact: 'Lowers expenses by about 5% and improves cash flow.',
    });
  }

  const debtRatio = kpis.debtToIncome?.value ?? 0;
  const debtGoal = kpis.debtToIncome?.goal ?? 0.35;
  if (debtRatio > debtGoal && !hasAction(actions, 'accelerate-debt')) {
    actions.push({
      id: 'accelerate-debt',
      title: 'Apply surplus to high-interest debt',
      description: 'Redirect part of the surplus each month toward the highest-rate balance to drop your debt ratio faster.',
      category: 'debt',
      rationale: `Debt-to-income at ${formatPercent(debtRatio)} exceeds the ${formatPercent(debtGoal)} ceiling.`,
      expectedImpact: 'Shrinks outstanding balances by ~5% over the next quarter.',
    });
  }

  const investmentRate = kpis.investmentRate?.value ?? 0;
  const investmentGoal = kpis.investmentRate?.goal ?? 0.15;
  if (investmentRate < investmentGoal && !hasAction(actions, 'boost-investments')) {
    actions.push({
      id: 'boost-investments',
      title: 'Increase recurring investment by a fixed amount',
      description: 'Raise the automated investment transfer to steadily climb toward the long-term allocation target.',
      category: 'investment',
      rationale: `Investment rate ${formatPercent(investmentRate)} trails the ${formatPercent(investmentGoal)} target.`,
      expectedImpact: 'Lifts investment rate by around 2 percentage points.',
    });
  }

  const income = kpis.income?.value ?? 0;
  const cashFlowComponent = health.components.find((component) => component.key === 'cashFlow');
  if (income > 0 && cashFlowComponent && cashFlowComponent.score < 0.5 && !hasAction(actions, 'grow-income')) {
    actions.push({
      id: 'grow-income',
      title: 'Pursue a side income experiment',
      description: 'Test a freelance or marketplace opportunity to add a steady secondary income stream.',
      category: 'income',
      rationale: 'Cash flow score flagged as weak, signalling limited buffer after expenses.',
      expectedImpact: 'Adds roughly 3% to income when successful.',
    });
  }

  if (!actions.length) {
    actions.push({
      id: 'stay-the-course',
      title: 'Stay the course',
      description: 'Financial health metrics align with plan. Continue current habits and review again next month.',
      category: 'savings',
      rationale: 'No critical KPI gaps detected.',
      expectedImpact: 'Maintains steady progress.',
    });
  }

  return actions;
}
