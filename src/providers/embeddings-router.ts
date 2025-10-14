/* eslint-disable @typescript-eslint/no-explicit-any */
import { setTimeout as delay } from "timers/promises";

export type EmbeddingProvider = "openai" | "fireworks";

export interface EmbeddingOptions {
  provider?: EmbeddingProvider;
  model?: string;
  batchSize?: number;
  signal?: AbortSignal;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  provider: EmbeddingProvider;
}

interface ProviderConfig {
  defaultModel: string;
  getApiKey(): string | undefined;
  endpoint: string;
  headers(apiKey: string): Record<string, string>;
  buildPayload(model: string, inputs: string[]): Record<string, any>;
  parseResponse(json: any): number[][];
}

const DEFAULT_BATCH = 32;
const MAX_CHARS = 400;
const RETRIES = 3;
const INITIAL_DELAY = 200;
const BACKOFF = 2;

const providerConfigs: Record<EmbeddingProvider, ProviderConfig> = {
  openai: {
    defaultModel: "text-embedding-3-small",
    getApiKey: () => process.env.OPENAI_API_KEY,
    endpoint: "https://api.openai.com/v1/embeddings",
    headers: (apiKey) => ({
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    }),
    buildPayload: (model, inputs) => ({
      model,
      input: inputs,
    }),
    parseResponse: (json) => {
      const data = json?.data;
      if (!Array.isArray(data)) {
        throw new Error("Malformed OpenAI embedding response");
      }
      return data.map((item: any) => item.embedding as number[]);
    },
  },
  fireworks: {
    defaultModel: "accounts/fireworks/models/llama-v3p1-8b-instruct",
    getApiKey: () => process.env.FIREWORKS_API_KEY,
    endpoint: "https://api.fireworks.ai/v1/embeddings",
    headers: (apiKey) => ({
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    }),
    buildPayload: (model, inputs) => ({
      model,
      input: inputs,
    }),
    parseResponse: (json) => {
      const data = json?.data;
      if (!Array.isArray(data)) {
        throw new Error("Malformed Fireworks embedding response");
      }
      return data.map((item: any) => item.embedding as number[]);
    },
  },
};

function sanitizeText(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= MAX_CHARS ? trimmed : trimmed.slice(0, MAX_CHARS);
}

function deduplicate(inputs: string[]): {
  unique: string[];
  reverseMap: Map<number, number[]>;
} {
  const unique: string[] = [];
  const seen = new Map<string, number>();
  const reverseMap = new Map<number, number[]>();

  inputs.forEach((value, idx) => {
    const key = value;
    if (!seen.has(key)) {
      seen.set(key, unique.length);
      unique.push(value);
    }
    const uniqueIndex = seen.get(key)!;
    if (!reverseMap.has(uniqueIndex)) {
      reverseMap.set(uniqueIndex, []);
    }
    reverseMap.get(uniqueIndex)!.push(idx);
  });

  return { unique, reverseMap };
}

async function callProviderBatch(
  provider: EmbeddingProvider,
  inputs: string[],
  options: EmbeddingOptions
): Promise<number[][]> {
  const config = providerConfigs[provider];
  if (!config) {
    throw new Error(`Unsupported embedding provider: ${provider}`);
  }
  const apiKey = config.getApiKey();
  if (!apiKey) {
    throw new Error(`Missing API key for provider ${provider}`);
  }
  const model = options.model ?? config.defaultModel;

  const payload = config.buildPayload(model, inputs);
  const init = {
    method: "POST",
    headers: config.headers(apiKey),
    body: JSON.stringify(payload),
    signal: options.signal,
  };

  const response = await withRetry(async () => {
    const res = await fetch(config.endpoint, init);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Embedding provider ${provider} failed with ${res.status}: ${text}`
      );
    }
    return res.json();
  });

  return config.parseResponse(response);
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  let delayMs = INITIAL_DELAY;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt > RETRIES) {
        throw error;
      }
      await delay(delayMs);
      delayMs *= BACKOFF;
    }
  }
}

export async function embedTexts(
  texts: string[],
  options: EmbeddingOptions = {}
): Promise<EmbeddingResponse> {
  if (!texts.length) {
    return {
      embeddings: [],
      model: options.model ?? providerConfigs[options.provider ?? "openai"].defaultModel,
      provider: options.provider ?? "openai",
    };
  }

  const provider = options.provider ??
    (process.env.DEFAULT_EMBEDDING_PROVIDER as EmbeddingProvider | undefined) ??
    "openai";

  const sanitized = texts.map(sanitizeText);
  const { unique, reverseMap } = deduplicate(sanitized);

  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  const results = new Array<number[]>(unique.length);

  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    const embeddings = await callProviderBatch(provider, batch, options);
    embeddings.forEach((embedding, idx) => {
      results[i + idx] = embedding;
    });
  }

  const ordered: number[][] = new Array(texts.length);
  results.forEach((embedding, uniqueIndex) => {
    const indices = reverseMap.get(uniqueIndex) ?? [];
    indices.forEach((originalIndex) => {
      ordered[originalIndex] = embedding;
    });
  });

  return {
    embeddings: ordered,
    model: options.model ?? providerConfigs[provider].defaultModel,
    provider,
  };
}
