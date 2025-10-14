import { listEmbeddings } from "../services/embeddings";
import { listInsights } from "../storage/insights";
import { RetrievalDocumentSchema, type RetrievalDocument } from "../orchestrator/schemas";
import type { VectorStore } from "../orchestrator";

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (!length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) {
    return 0;
  }
  return dot / Math.sqrt(normA * normB);
}

export const insightVectorStore: VectorStore = {
  async search(userId, queryEmbedding, options): Promise<RetrievalDocument[]> {
    const limit = options?.limit ?? 5;
    const embeddings = listEmbeddings().filter(
      (record) => record.metadata.userId === userId,
    );
    if (!embeddings.length) {
      return [];
    }
    const insights = listInsights(userId);
    const documents = embeddings
      .map((record) => {
        const insight = insights.find((entry) => entry.id === record.id);
        if (!insight) {
          return null;
        }
        const score = cosineSimilarity(queryEmbedding, record.vector);
        const doc: RetrievalDocument = {
          id: record.id,
          userId,
          content: insight.story,
          metadata: {
            ...record.metadata,
            score,
            month: insight.month,
            kpis: insight.kpis,
          },
        };
        return doc;
      })
      .filter((value): value is RetrievalDocument => Boolean(value))
      .sort((a, b) => {
        const scoreA = typeof a.metadata?.score === "number" ? a.metadata.score : 0;
        const scoreB = typeof b.metadata?.score === "number" ? b.metadata.score : 0;
        return scoreB - scoreA;
      })
      .slice(0, Math.max(1, limit))
      .map((doc) => RetrievalDocumentSchema.parse(doc));
    return documents;
  },
};
