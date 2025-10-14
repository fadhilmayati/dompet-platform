import {
  HealthScoreResult,
  MonthlyInsight,
  SimulationResult,
  SuggestedAction,
  KPISet,
} from '../types';
import { scoreFinancialHealth } from '../score/health';
import { craftMonthlyStory } from '../memory/monthly';

function cloneInsight(insight: MonthlyInsight): MonthlyInsight {
  return {
    ...insight,
    kpis: Object.entries(insight.kpis).reduce<KPISet>((accumulator, [key, value]) => {
      accumulator[key] = { ...value };
      return accumulator;
    }, {}),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function adjustSavings(projected: MonthlyInsight, delta: number): number {
  const income = projected.kpis.income?.value ?? 0;
  const savingsRateKpi = projected.kpis.savingsRate;
  const expenseKpi = projected.kpis.expenses;
  const cashFlowKpi = projected.kpis.cashFlow;
  if (!savingsRateKpi || !expenseKpi || !cashFlowKpi || income <= 0) {
    return 0;
  }

  const previousRate = savingsRateKpi.value;
  const newRate = clamp(previousRate + delta, 0, 0.8);
  const rateDelta = newRate - previousRate;
  savingsRateKpi.value = newRate;

  const change = income * rateDelta;
  expenseKpi.value = Math.max(0, expenseKpi.value - change);
  cashFlowKpi.value += change;
  if (projected.kpis.expenseRatio) {
    projected.kpis.expenseRatio.value = clamp(expenseKpi.value / income, 0, 2);
  }
  return change;
}

function adjustExpenses(projected: MonthlyInsight, percent: number): number {
  const income = projected.kpis.income?.value ?? 0;
  const expenseKpi = projected.kpis.expenses;
  const cashFlowKpi = projected.kpis.cashFlow;
  if (!expenseKpi || !cashFlowKpi) {
    return 0;
  }
  const reduction = expenseKpi.value * percent;
  expenseKpi.value = Math.max(0, expenseKpi.value - reduction);
  cashFlowKpi.value += reduction;
  if (income > 0 && projected.kpis.savingsRate) {
    const surplus = income - expenseKpi.value;
    projected.kpis.savingsRate.value = clamp(surplus / income, 0, 1.2);
  }
  if (income > 0 && projected.kpis.expenseRatio) {
    projected.kpis.expenseRatio.value = clamp(expenseKpi.value / income, 0, 1.5);
  }
  return reduction;
}

function adjustDebt(projected: MonthlyInsight, percent: number): number {
  const debtOutstanding = projected.kpis.debtOutstanding ?? projected.kpis.debtToIncome;
  if (!debtOutstanding) {
    return 0;
  }
  const income = projected.kpis.income?.value ?? 0;
  const current = debtOutstanding.value;
  const reduction = current * percent;
  debtOutstanding.value = Math.max(0, current - reduction);
  if (projected.kpis.debtToIncome) {
    projected.kpis.debtToIncome.value = income > 0 ? clamp(debtOutstanding.value / income, 0, 2) : 0;
  }
  return reduction;
}

function adjustInvestments(projected: MonthlyInsight, delta: number): number {
  const income = projected.kpis.income?.value ?? 0;
  const investmentKpi = projected.kpis.investments;
  const investmentRateKpi = projected.kpis.investmentRate;
  const cashFlowKpi = projected.kpis.cashFlow;
  if (!investmentKpi || !investmentRateKpi || !cashFlowKpi || income <= 0) {
    return 0;
  }
  const additionalContribution = income * delta;
  investmentKpi.value += additionalContribution;
  investmentRateKpi.value = clamp(investmentKpi.value / income, 0, 1.2);
  cashFlowKpi.value -= additionalContribution;
  return additionalContribution;
}

function adjustIncome(projected: MonthlyInsight, percent: number): number {
  const incomeKpi = projected.kpis.income;
  if (!incomeKpi) {
    return 0;
  }
  const increase = incomeKpi.value * percent;
  incomeKpi.value += increase;
  const expenseKpi = projected.kpis.expenses;
  const investmentKpi = projected.kpis.investments;
  const cashFlowKpi = projected.kpis.cashFlow;
  if (cashFlowKpi) {
    cashFlowKpi.value += increase;
  }
  if (expenseKpi) {
    if (projected.kpis.expenseRatio) {
      projected.kpis.expenseRatio.value = clamp(expenseKpi.value / incomeKpi.value, 0, 2);
    }
  }
  if (projected.kpis.savingsRate && expenseKpi) {
    const surplus = incomeKpi.value - expenseKpi.value;
    projected.kpis.savingsRate.value = clamp(surplus / incomeKpi.value, 0, 1.2);
  }
  if (investmentKpi && projected.kpis.investmentRate) {
    projected.kpis.investmentRate.value = clamp(investmentKpi.value / incomeKpi.value, 0, 1.2);
  }
  if (projected.kpis.debtToIncome) {
    const outstanding = projected.kpis.debtOutstanding?.value ?? projected.kpis.debtToIncome.value * (incomeKpi.value - increase);
    projected.kpis.debtToIncome.value = incomeKpi.value > 0 ? clamp(outstanding / incomeKpi.value, 0, 2) : projected.kpis.debtToIncome.value;
  }
  return increase;
}

function refreshDerived(projected: MonthlyInsight): void {
  const income = projected.kpis.income?.value ?? 0;
  const expenses = projected.kpis.expenses?.value ?? 0;
  const investments = projected.kpis.investments?.value ?? 0;
  const debtPayments = projected.kpis.debtPayments?.value ?? 0;
  if (projected.kpis.cashFlow) {
    projected.kpis.cashFlow.value = income - expenses - investments - debtPayments;
  }
  if (projected.kpis.savingsRate && income > 0) {
    projected.kpis.savingsRate.value = clamp((income - expenses) / income, 0, 1.2);
  }
  if (projected.kpis.investmentRate && income > 0) {
    projected.kpis.investmentRate.value = clamp(investments / income, 0, 1.2);
  }
  if (projected.kpis.expenseRatio && income > 0) {
    projected.kpis.expenseRatio.value = clamp(expenses / income, 0, 1.5);
  }
  if (projected.kpis.debtToIncome && income > 0) {
    const debtOutstanding = projected.kpis.debtOutstanding?.value ?? projected.kpis.debtToIncome.value * income;
    projected.kpis.debtToIncome.value = clamp(debtOutstanding / income, 0, 2);
  }
}

function ensureDebtOutstanding(projected: MonthlyInsight): void {
  if (!projected.kpis.debtOutstanding) {
    const debtToIncome = projected.kpis.debtToIncome?.value ?? 0;
    const income = projected.kpis.income?.value ?? 0;
    projected.kpis.debtOutstanding = {
      key: 'debtOutstanding',
      label: 'Debt outstanding',
      value: income * debtToIncome,
      unit: 'currency',
    };
  }
}

export function simulateAdjustments(
  insight: MonthlyInsight,
  actions: SuggestedAction[],
): SimulationResult {
  const projected = cloneInsight(insight);
  ensureDebtOutstanding(projected);

  const adjustments: Record<string, number> = {};

  for (const action of actions) {
    switch (action.id) {
      case 'improve-savings': {
        adjustments[action.id] = adjustSavings(projected, 0.03);
        break;
      }
      case 'optimize-expenses': {
        adjustments[action.id] = adjustExpenses(projected, 0.05);
        break;
      }
      case 'accelerate-debt': {
        adjustments[action.id] = adjustDebt(projected, 0.05);
        break;
      }
      case 'boost-investments': {
        adjustments[action.id] = adjustInvestments(projected, 0.02);
        break;
      }
      case 'grow-income': {
        adjustments[action.id] = adjustIncome(projected, 0.03);
        break;
      }
      default: {
        adjustments[action.id] = 0;
        break;
      }
    }
  }

  refreshDerived(projected);
  projected.story = craftMonthlyStory(`${projected.month} (projected)`, projected.kpis);

  const projectedHealth: HealthScoreResult = scoreFinancialHealth(projected.kpis);

  return {
    projectedInsight: projected,
    projectedHealth,
    adjustments,
  };
}
