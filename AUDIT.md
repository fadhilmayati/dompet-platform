🛡️ DOMPET PLATFORM – PRE-DEPLOY AUDIT REPORT
Audited by: ChatGPT (gpt-5-codex)
Date: 2025-10-14
Repo commit: fa1b178
Audit scope: Full backend readiness review before Railway deployment.

1. 🔐 Security & Auth

| Check | Status (✅/❌) | Notes / Fix recommendations |
| --- | --- | --- |
| All DB queries and writes scoped by user_id | ❌ | Aggregations for `/benchmarks` read every tenant payment intent without customer/user filters, leaking peer spend data across opt-outs.【F:src/api/v1/index.ts†L412-L446】 |
| Idempotency on add_transaction and write ops | ❌ | `persistTransaction` inserts a new payment intent keyed by `chat-${Date.now()}` on every call, so retries duplicate rows; add idempotency keys plus conflict handling.【F:src/api/v1/index.ts†L120-L164】 |
| zod validation on all inputs and outputs | ❌ | Requests are parsed with Zod, but responses like `/chat` and `/insights` send raw objects without schema enforcement or sanitisation before returning.【F:src/api/v1/index.ts†L217-L264】 |
| Rate-limiting implemented on write endpoints | ❌ | No throttling middleware; POST routes `/chat`, `/insights`, `/score`, `/simulate`, `/upload-csv`, `/preferences` call straight through without limits.【F:src/api/v1/index.ts†L167-L515】 |
| No secrets logged or leaked to console/errors | ✅ | Only startup banner is logged; no API keys or tokens are printed.【F:src/server.ts†L14-L31】 |
| Benchmarking endpoints require opt-in and anonymize identifiers | ❌ | `/benchmarks` and `/leaderboard` never check an `allow_benchmarking` flag nor anonymize identifiers; raw tenant stats and "You" labels are exposed.【F:src/api/v1/index.ts†L412-L476】 |

2. 📡 API Contract Validation

| Endpoint | Tested | Pass/Fail | Notes |
| --- | --- | --- | --- |
| POST /v1/chat | No | ❌ | Implemented at `/api/v1/chat` and returns `{ data: result }` instead of `{ reply, kpis?, actions?, followup? }`; missing schema enforcement.【F:src/api/v1/index.ts†L167-L218】 |
| GET /v1/insights?month= | No | ❌ | Lives at `/api/v1/insights`, returns `{ data: { insights, recentTransactions } }` rather than `{ kpis, story }` for a month.【F:src/api/v1/index.ts†L220-L265】 |
| GET /v1/score?month= | No | ❌ | Score is a POST to `/api/v1/score` and responds with `{ data: { score, kpis, transactionCount } }`, not the required `{ score, components, notes? }` query endpoint.【F:src/api/v1/index.ts†L300-L323】 |
| POST /v1/simulate | No | ❌ | Returns `{ data: { simulation } }` instead of `{ kpis, score }`, and path includes `/api` prefix.【F:src/api/v1/index.ts†L325-L342】 |
| POST /v1/upload-csv | No | ❌ | Expects JSON `{ csv }`, processes all rows at once, and responds with `{ data: { insight, imported, totalAmount } }`; contract requires ≤500-row batches and ingest summary `{ ingestedCount, batches[] }`.【F:src/api/v1/index.ts†L344-L392】 |
| GET /v1/benchmarks | No | ❌ | Path mismatch and response exposes tenant averages without opt-in or anonymization; schema deviates from spec.【F:src/api/v1/index.ts†L412-L446】 |
| GET /v1/leaderboard | No | ❌ | Only returns "You" and "Tenant peers" with raw scores, lacks anonymized identifiers and opt-in gating.【F:src/api/v1/index.ts†L449-L476】 |
| GET/POST /v1/preferences | No | ❌ | Implemented as GET/PUT under `/api/v1/preferences`, storing payload verbatim in `metadata` without validation of response schema.【F:src/api/v1/index.ts†L478-L515】 |
| GET /v1/healthz | No | ❌ | Endpoint absent; only root `/` health ping exists, so deployment monitors cannot probe `/v1/healthz`.【F:src/server.ts†L14-L31】 |

Notes on schema mismatches or inconsistencies:
- Every route is nested under `/api/v1` instead of `/v1`, breaking the published contract.
- Response envelopes wrap data in `{ data: ... }`, diverging from required JSON structures for chat, insights, score, simulate, upload-csv, benchmarks, leaderboard, and preferences.【F:src/api/v1/index.ts†L217-L515】
- Typed error codes (`VALIDATION_ERROR`, `AUTH_REQUIRED`, etc.) are not surfaced; handlers rely on generic `HTTPException` strings.【F:src/api/v1/index.ts†L167-L515】

3. 🧠 MCP Tools Audit

| Tool | Status | Notes |
| --- | --- | --- |
| add_transaction | ❌ | No `add_transaction` tool is exported; closest is `transactions.create` with different schema and return shape.【F:src/mcp/tools.ts†L119-L193】 |
| normalize_csv | ❌ | Absent from MCP catalogue; CSV handling occurs ad-hoc inside the HTTP handler rather than a reusable tool.【F:src/mcp/tools.ts†L17-L347】【F:src/api/v1/index.ts†L344-L392】 |
| apply_rules | ❌ | Not implemented; MCP only exposes `rules.list` and lacks any rule application executor.【F:src/mcp/tools.ts†L194-L347】 |
| budget_insights | ❌ | Missing; no tool surfaces monthly insights generation via MCP APIs.【F:src/mcp/tools.ts†L17-L347】 |
| anomaly_check | ❌ | Not present in tool registry.【F:src/mcp/tools.ts†L17-L347】 |
| store_facts | ❌ | No persistence tool for factual memory; storage is only via in-memory arrays.【F:src/storage/insights.ts†L3-L33】【F:src/mcp/tools.ts†L17-L347】 |
| search_memory | ❌ | Vector search is only available to the orchestrator, not via an MCP tool entry.【F:src/mcp/tools.ts†L17-L347】【F:src/api/vector-store.ts†L1-L44】 |

Typed errors returned correctly? ❌ — Tools return `{ ok, message }` or throw, without standardized error codes like `VALIDATION_ERROR` or `RATE_LIMIT`.【F:src/mcp/tools.ts†L63-L347】

Input validation correct? ❌ — While Zod parses inputs, missing tools and inconsistent schemas prevent end-to-end validation of the required toolset.【F:src/mcp/tools.ts†L63-L347】

CSV ingestion handles large batches? ❌ — Upload handler loads the entire payload into memory, with no batching or streaming safeguards for 2k rows.【F:src/api/v1/index.ts†L344-L392】

4. 🧠 Memory & Embeddings

| Check | Status | Notes |
| --- | --- | --- |
| pgvector extension enabled | ❌ | Schema defines `customer_embeddings.embedding` with 1536-dim vector, but application never writes to this table; embeddings live in volatile in-memory maps, so pgvector is unused.【F:drizzle/schema.ts†L220-L276】【F:src/services/embeddings.ts†L7-L45】 |
| VECTOR_DIM matches embedding size | ❌ | No constant or assertion exists; in-memory vectors are sized to 7 KPIs, mismatching the 1536-dimension pgvector schema and risking runtime errors if persisted.【F:src/memory/monthly.ts†L199-L216】【F:drizzle/schema.ts†L240-L264】 |
| Deduplication and truncation (≤400 chars) implemented | ✅ | `embedTexts` trims inputs to 400 chars and deduplicates before batching provider calls, preventing duplicate billing.【F:src/providers/embeddings-router.ts†L28-L199】 |
| Monthly summary creates insight + embedding | ❌ | Summaries call `upsertInsight` and `upsertEmbedding`, but both write to in-memory stores instead of Postgres tables, so data vanishes on restart.【F:src/memory/monthly.ts†L188-L216】【F:src/storage/insights.ts†L3-L33】【F:src/services/embeddings.ts†L7-L45】 |
| searchMemory returns top-K and is user-scoped | ⚠️ | Vector store filters by `userId`, but it queries only in-memory embeddings; without persistence or pgvector queries, results disappear across processes.【F:src/api/vector-store.ts†L1-L44】 |

5. 🧠 Orchestrator Flow

| Step | Status | Notes |
| --- | --- | --- |
| Intent detection reliable | ❌ | Single-shot `classifyIntent` call lacks confidence thresholds or fallbacks; low-confidence paths are not handled separately.【F:src/orchestrator/index.ts†L405-L424】 |
| Context retrieval (memory + last messages) works | ⚠️ | Retrieval queries the in-memory vector store and filters by user, but without persisted embeddings any restart empties context, reducing reliability.【F:src/orchestrator/index.ts†L151-L194】【F:src/api/vector-store.ts†L1-L44】 |
| Tool execution correct and scoped | ❌ | Only `transactions.create` is wired; required MCP tools (`add_transaction`, rules, budgeting) are missing, and no tenant isolation is enforced inside tool handlers beyond current user context.【F:src/orchestrator/index.ts†L185-L285】 |
| Output validation (zod) and retry logic | ❌ | LLM/tool outputs are parsed once with Zod; failures throw without retry, violating "retry once on schema fail" guideline.【F:src/orchestrator/index.ts†L202-L285】 |
| Clarifier limited to one question | ❌ | No clarifying-question branch exists; orchestrator never asks follow-ups even on low confidence intents.【F:src/orchestrator/index.ts†L405-L440】 |

6. ⚙️ Performance & Cost Observations

CSV ingestion (2k rows) – runtime: Not executed (handler processes entire payload synchronously; expect degraded performance above hundreds of rows).【F:src/api/v1/index.ts†L344-L392】

Peak memory usage: Not measured (risk of high memory use due to full CSV buffering and in-memory insight stores).【F:src/api/v1/index.ts†L344-L392】【F:src/storage/insights.ts†L3-L33】

Token/call metrics implemented: No — provider routers do not record usage statistics or per-intent counters.【F:src/providers/model-router.ts†L1-L200】

N+1 queries: Found — Repeated insight aggregation loops fetch all customer insights from in-memory arrays, and leaderboard recalculates peer averages each request without caching.【F:src/api/v1/index.ts†L412-L476】

Recommendations:
- Implement streaming/ batched CSV ingestion with ≤500 row chunks and persist normalized rows to Postgres.
- Add provider usage telemetry (tokens, call counts) per intent to manage spend.【F:src/providers/model-router.ts†L1-L200】
- Replace in-memory insight/embedding stores with pgvector-backed persistence to avoid data loss and repeated recomputation.【F:src/memory/monthly.ts†L188-L216】【F:src/services/embeddings.ts†L7-L45】

7. 🤝 Privacy & Community Layer

| Check | Status | Notes |
| --- | --- | --- |
| Benchmarking requires opt-in | ❌ | No `allow_benchmarking` gating; all tenant data is aggregated regardless of consent.【F:src/api/v1/index.ts†L412-L446】 |
| Peer groups bucketed by region/income_band | ❌ | Benchmarks aggregate across entire tenant without segmentation fields.【F:src/api/v1/index.ts†L412-L446】 |
| Leaderboard aliases anonymized | ❌ | Leaderboard uses literal "You" and "Tenant peers" without emoji/hash anonymization or opt-in filtering.【F:src/api/v1/index.ts†L449-L476】 |

8. ☁️ Deployment Readiness (Railway)

| Item | Status | Notes |
| --- | --- | --- |
| npm run start boots clean with .env | ❌ | `start` expects `dist/server.js`, but no build step runs automatically; without `npm run build`, Railway start fails.【F:package.json†L7-L24】 |
| /v1/healthz present and returns { ok: true } | ❌ | Health check only exists at root `/`; missing `/v1/healthz` handler required for platform monitoring.【F:src/server.ts†L14-L31】 |
| No file-system writes; DB + env only | ❌ | Insights and embeddings persist in process memory rather than Postgres, so state is neither durable nor multi-instance safe.【F:src/storage/insights.ts†L3-L33】【F:src/services/embeddings.ts†L7-L45】 |
| Compatible with Railway Postgres (SSL) | ❌ | Database pool omits `ssl` options; Railway’s `sslmode=require` URIs need `{ ssl: { rejectUnauthorized: false } }` for pg to connect.【F:src/db/client.ts†L7-L45】 |

📊 Summary Findings

Critical issues (must fix before deploy):
- Multi-tenant isolation breaches in benchmarking endpoints leak tenant-wide metrics without opt-in.【F:src/api/v1/index.ts†L412-L476】
- API contract divergences across every endpoint break client integrations and lack typed error handling.【F:src/api/v1/index.ts†L167-L515】
- Memory/embedding layers store data in-process instead of Postgres/pgvector, causing data loss and violating requirements.【F:src/memory/monthly.ts†L188-L216】【F:src/storage/insights.ts†L3-L33】

Important (should fix soon):
- Missing rate limits and idempotency expose write amplification risks under retries.【F:src/api/v1/index.ts†L120-L392】
- Orchestrator lacks low-confidence handling, retries, and tool coverage for the MCP toolchain.【F:src/orchestrator/index.ts†L202-L440】【F:src/mcp/tools.ts†L63-L347】
- Upload CSV pipeline ignores batching and can exhaust memory on large files.【F:src/api/v1/index.ts†L344-L392】

Nice-to-have (optional):
- Implement caching for benchmarks/leaderboard to reduce repeated aggregations once privacy controls land.【F:src/api/v1/index.ts†L412-L476】
- Expand provider routing to prefer cheaper models for classification vs. synthesis once reliability improved.【F:src/providers/model-router.ts†L86-L198】

✅ Final Verdict

| Criteria | Status |
| --- | --- |
| Security pass | ❌ |
| API contracts stable | ❌ |
| Performance acceptable | ❌ |
| Privacy compliant | ❌ |
| Deployment-ready | ❌ |

Overall Recommendation: ⚠️ Fix required before deploy
