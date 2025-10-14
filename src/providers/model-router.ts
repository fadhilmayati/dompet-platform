/* eslint-disable @typescript-eslint/no-explicit-any */
import { setTimeout as delay } from "timers/promises";

export type ProviderName = "openai" | "anthropic" | "fireworks";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelCallOptions {
  provider?: ProviderName;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LLMResponse {
  provider: ProviderName;
  model: string;
  message: ChatMessage;
  raw: unknown;
  usage?: Record<string, any>;
}

export interface IntentClassification {
  intent: "record_transaction" | "budget_summary" | "general_question" | "unknown";
  confidence: number;
  reasoning?: string;
}

export interface TransactionExtraction {
  amount: number | null;
  currency: string | null;
  occurredAt: string | null;
  merchant?: string | null;
  category?: string | null;
  notes?: string | null;
  description?: string | null;
  rawText?: string;
}

export interface SummarizeMonthInput {
  userId: string;
  month: string;
  transactions: Array<Record<string, any>>;
  context?: string[];
  tone?: "formal" | "friendly" | "celebratory";
}

export interface MonthlySummary {
  summary: string;
  highlights: string[];
  savingsOpportunities: string[];
  followUps?: string[];
}

type Retryable<T> = () => Promise<T>;

interface RetryOptions {
  retries?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
}

interface ProviderHandler {
  name: ProviderName;
  defaultModel: string;
  getApiKey(): string | undefined;
  endpointFor(model: string): string;
  buildRequest(
    messages: ChatMessage[],
    options: Required<Pick<ModelCallOptions, "model" | "temperature" | "maxTokens">>
  ): Record<string, any>;
  buildHeaders(apiKey: string): Record<string, string>;
  parseResponse(json: any): LLMResponse;
}

const DEFAULT_RETRY: Required<RetryOptions> = {
  retries: 3,
  initialDelayMs: 250,
  backoffFactor: 2,
};

const DEFAULT_MODELS: Record<ProviderName, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-haiku-20240307",
  fireworks: "accounts/fireworks/models/llama-v3p1-70b-instruct",
};

const providerHandlers: Record<ProviderName, ProviderHandler> = {
  openai: {
    name: "openai",
    defaultModel: DEFAULT_MODELS.openai,
    getApiKey: () => process.env.OPENAI_API_KEY,
    endpointFor: () => "https://api.openai.com/v1/chat/completions",
    buildHeaders: (apiKey) => ({
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    }),
    buildRequest: (messages, options) => ({
      model: options.model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      response_format: { type: "json_object" },
    }),
    parseResponse: (json) => {
      const choice = json?.choices?.[0]?.message;
      if (!choice) {
        throw new Error("OpenAI response missing choices[0].message");
      }
      return {
        provider: "openai",
        model: json?.model ?? DEFAULT_MODELS.openai,
        message: {
          role: choice.role ?? "assistant",
          content: choice.content ?? "",
        },
        usage: json?.usage ?? undefined,
        raw: json,
      };
    },
  },
  anthropic: {
    name: "anthropic",
    defaultModel: DEFAULT_MODELS.anthropic,
    getApiKey: () => process.env.ANTHROPIC_API_KEY,
    endpointFor: () => "https://api.anthropic.com/v1/messages",
    buildHeaders: (apiKey) => ({
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    }),
    buildRequest: (messages, options) => {
      const systemMessages = messages.filter((msg) => msg.role === "system");
      const nonSystem = messages.filter((msg) => msg.role !== "system");
      const system = systemMessages.map((msg) => msg.content).join("\n\n");
      return {
        model: options.model,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        system: system || undefined,
        messages: nonSystem.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
      };
    },
    parseResponse: (json) => {
      const content = json?.content?.[0]?.text ?? json?.content ?? "";
      return {
        provider: "anthropic",
        model: json?.model ?? DEFAULT_MODELS.anthropic,
        message: {
          role: "assistant",
          content,
        },
        usage: json?.usage ?? undefined,
        raw: json,
      };
    },
  },
  fireworks: {
    name: "fireworks",
    defaultModel: DEFAULT_MODELS.fireworks,
    getApiKey: () => process.env.FIREWORKS_API_KEY,
    endpointFor: () => "https://api.fireworks.ai/inference/v1/chat/completions",
    buildHeaders: (apiKey) => ({
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    }),
    buildRequest: (messages, options) => ({
      model: options.model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      response_format: { type: "json_object" },
    }),
    parseResponse: (json) => {
      const choice = json?.choices?.[0]?.message;
      if (!choice) {
        throw new Error("Fireworks response missing choices[0].message");
      }
      return {
        provider: "fireworks",
        model: json?.model ?? DEFAULT_MODELS.fireworks,
        message: {
          role: choice.role ?? "assistant",
          content: choice.content ?? "",
        },
        usage: json?.usage ?? undefined,
        raw: json,
      };
    },
  },
};

async function withRetry<T>(operation: Retryable<T>, options?: RetryOptions): Promise<T> {
  const config: Required<RetryOptions> = {
    retries: options?.retries ?? DEFAULT_RETRY.retries,
    initialDelayMs: options?.initialDelayMs ?? DEFAULT_RETRY.initialDelayMs,
    backoffFactor: options?.backoffFactor ?? DEFAULT_RETRY.backoffFactor,
  };

  let attempt = 0;
  let waitMs = config.initialDelayMs;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      if (attempt > config.retries) {
        throw error;
      }
      await delay(waitMs);
      waitMs *= config.backoffFactor;
    }
  }
}

async function dispatchChatCall(
  messages: ChatMessage[],
  options: ModelCallOptions = {}
): Promise<LLMResponse> {
  const provider = options.provider ??
    (process.env.DEFAULT_MODEL_PROVIDER as ProviderName | undefined) ??
    "openai";
  const handler = providerHandlers[provider];
  if (!handler) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const apiKey = handler.getApiKey();
  if (!apiKey) {
    throw new Error(`Missing API key for provider ${provider}`);
  }

  const model = options.model ?? handler.defaultModel;
  const temperature = options.temperature ?? 0.1;
  const maxTokens = options.maxTokens ?? 512;

  const requestBody = handler.buildRequest(messages, {
    model,
    temperature,
    maxTokens,
  });

  const requestInit = {
    method: "POST",
    headers: handler.buildHeaders(apiKey),
    body: JSON.stringify(requestBody),
    signal: options.signal,
  };

  const response = await withRetry(async () => {
    const res = await fetch(handler.endpointFor(model), requestInit);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Provider ${provider} request failed with ${res.status}: ${text}`
      );
    }
    return res.json();
  });

  return handler.parseResponse(response);
}

function coerceJSON<T = any>(raw: string): T {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const candidate = start >= 0 && end >= 0 ? raw.slice(start, end + 1) : raw;

  try {
    return JSON.parse(candidate) as T;
  } catch (error) {
    throw new Error(`Failed to parse JSON from model output: ${raw}\n${error}`);
  }
}

export async function classifyIntent(
  conversation: ChatMessage[],
  options?: ModelCallOptions
): Promise<IntentClassification> {
  const systemPrompt =
    "You are an intent classifier for a personal finance assistant called Dompet. " +
    "Classify the user's latest request into one of: record_transaction, budget_summary, " +
    "general_question, unknown. Return strict JSON with keys intent, confidence (0-1), and reasoning.";

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...conversation,
  ];

  const response = await dispatchChatCall(messages, options);
  const parsed = coerceJSON<IntentClassification>(response.message.content);

  return parsed;
}

export async function extractTransaction(
  message: string,
  options?: ModelCallOptions
): Promise<TransactionExtraction> {
  const systemPrompt =
    "You are an information extraction agent for Dompet. " +
    "Extract transaction details from the user text. Output JSON with keys amount (number), currency (string), " +
    "occurredAt (ISO 8601 string), merchant, category, notes, description, rawText. Unknown fields should be null.";

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: message },
  ];

  const response = await dispatchChatCall(messages, options);
  const parsed = coerceJSON<TransactionExtraction>(response.message.content);
  parsed.rawText = message;

  return parsed;
}

export async function summarizeMonthLLM(
  payload: SummarizeMonthInput,
  options?: ModelCallOptions
): Promise<MonthlySummary> {
  const { userId, month, transactions, context = [], tone = "friendly" } = payload;

  const instruction =
    `You are Dompet, a finance assistant. Create a monthly summary for user ${userId} ` +
    `covering ${month}. Combine the structured transactions and contextual notes. ` +
    `Output JSON with keys summary (string), highlights (string[]), ` +
    `savingsOpportunities (string[]), followUps (string[] optional). Use a ${tone} tone.`;

  const messages: ChatMessage[] = [
    { role: "system", content: instruction },
    {
      role: "user",
      content: JSON.stringify({ transactions, context }),
    },
  ];

  const response = await dispatchChatCall(messages, options);
  const parsed = coerceJSON<MonthlySummary>(response.message.content);

  return parsed;
}

export async function callChatModel(
  messages: ChatMessage[],
  options?: ModelCallOptions
): Promise<LLMResponse> {
  return dispatchChatCall(messages, options);
}
