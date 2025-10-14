import { InsightRecord, MonthlyInsight } from '../types';

const insightStore: InsightRecord[] = [];

export function upsertInsight(insight: MonthlyInsight): MonthlyInsight {
  const index = insightStore.findIndex(
    (existing) => existing.userId === insight.userId && existing.month === insight.month,
  );

  const normalized: InsightRecord = {
    ...insight,
    story: insight.story.trim(),
  };

  if (index >= 0) {
    insightStore[index] = normalized;
  } else {
    insightStore.push(normalized);
  }

  return normalized;
}

export function listInsights(userId?: string): MonthlyInsight[] {
  if (!userId) {
    return insightStore.map((entry) => ({ ...entry }));
  }

  return insightStore.filter((entry) => entry.userId === userId).map((entry) => ({ ...entry }));
}

export function clearInsights(): void {
  insightStore.splice(0, insightStore.length);
}
