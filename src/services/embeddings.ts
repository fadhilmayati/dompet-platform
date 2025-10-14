interface EmbeddingRecord {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

const embeddings = new Map<string, EmbeddingRecord>();

function normalizeVector(vector: number[]): number[] {
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!length) {
    return vector.map(() => 0);
  }
  return vector.map((value) => value / length);
}

export function upsertEmbedding(
  id: string,
  vector: number[],
  metadata: Record<string, unknown> = {},
): EmbeddingRecord {
  const normalized = normalizeVector(vector);
  const record: EmbeddingRecord = { id, vector: normalized, metadata };
  embeddings.set(id, record);
  return record;
}

export function getEmbedding(id: string): EmbeddingRecord | undefined {
  const entry = embeddings.get(id);
  if (!entry) {
    return undefined;
  }
  return { id: entry.id, vector: [...entry.vector], metadata: { ...entry.metadata } };
}

export function clearEmbeddings(): void {
  embeddings.clear();
}
