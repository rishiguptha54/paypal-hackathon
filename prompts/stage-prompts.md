# IntentLock — Stage Prompts for Copilot Chat (Agent mode)

Copy one block at a time into VS Code Copilot Chat (Agent mode). Finish and verify a stage before starting the next.

| Stage | Goal | Target |
|---|---|---|
| 1 | Foundation + PayPal money spine (MCP + REST) + first Render deploy | Sun 8 Nov |
| 2 | Pure core + Gemini mandate + Channel3/fixtures + purchase API (first submittable) | Mon 9 Nov |
| 3 | Integrity: capture gate, audit chain, drift sim, seeder, receipts | Tue 10 Nov AM |
| 4 | Full UI, AG Grid ledger, AG Studio dashboard + widget + agent | Tue 10 PM – Wed 11 AM |
| 5 | E2E, OpenAPI/Postman, README Judge Quickstart, spec patch, submit | Wed 11 Nov, by 18:00 IST |

---

## Stage 1 — Foundation + PayPal money spine

```text
You are implementing IntentLock (PayPal AI Hackathon). Work only in the personal clone; never commit .env.

Read: spec/README.md, spec/research.md §2, spec/architecture.md §3–§5, §6.3, §10, §12–§14, spec/data-model.md (sessions, purchases, payment_operations), spec/contracts/api.md §1, §3 routes 1, 2, 10, 11, §6, spec/security.md §5, §7.

Implement ONLY Stage 1 (spec/tasks.md T001–T015):
1. npm workspaces monorepo: apps/api (Express 5, TS strict), apps/web (React+Vite), packages/shared (Zod schemas/types only). ESLint, Prettier, MIT LICENSE, .gitignore (.env* except .env.example), .env.example with <REPLACE_ME> for every var in architecture §12.
2. config.ts: Zod-validated env, fail fast, refuse to boot unless PAYPAL_ENV=sandbox. pino with redaction, requestId, error envelope (no stack traces), helmet headers per security §5, JSON-only + 16 KB limit, signed il_sid session cookie.
3. Postgres via Drizzle using a hosted DATABASE_URL (no Docker). Tests use PGlite. Migrations: sessions, purchases (minimal), payment_operations (incl. channel, mcp_tool).
4. adapters/paypal (REST): OAuth token cache, getOrder, captureOrder, createOrder (fallback only), PayPal-Request-Id, 15 s timeout, record paypal-debug-id, Zod-validated responses.
5. adapters/paypalMcp (PayPalMcpGateway): spawn the official PayPal MCP Server over stdio (pinned dependency, never npx download at runtime) with a short-lived sandbox access token only. At startup list tools; allow-list ONLY create_order and get_order. FIRST confirm the real tool names/arguments from the installed package and report them. Zod-validate results, 15 s timeout, return a trace summary. If MCP cannot start, fall back to REST behind the same interface and log it clearly. Add a stub MCP server for tests.
6. Temporary route to create a $1.00 purchase; POST /api/purchases/:id/paypal/create-order and POST /api/purchases/:id/paypal/capture with get-or-create payment_operations and the stable request ID. GET /api/health (status values only) and GET /api/config (public values only).
7. Web: PayPal JS SDK v6 (or @paypal/react-paypal-js if v6 blocks) — createOrder -> create-order route, onApprove -> capture route; show verified status.
8. render.yaml (single web service, SPA served by API, health path /api/health); GitHub Actions: typecheck, lint, unit tests, gitleaks, npm audit --omit=dev.

Rules: no hardcoded secrets; money as bigint minor units; client never sends amounts.
Tests: UNIT-CFG-01, UNIT-MCP-01, SEC-02, SEC-11, SEC-12, INT-25.
Run typecheck and tests; report exact commands and results. If a PayPal/MCP detail is unverified, stop and list the question instead of guessing.
```

**Exit check (G0):** a $1.00 purchase reaches `COMPLETED` on the hosted URL and matches PayPal's live order.

---

## Stage 2 — Core, Gemini mandate, catalog, purchase API

```text
Continue IntentLock. Stage 1 is merged; do not change PayPal adapters except to call them. Work only in the personal clone; never commit .env.

Read: spec/spec.md US-1..US-4 and FR-01..FR-12, spec/architecture.md §6.1–6.2, §7–§9, ADR-006, spec/data-model.md (mandates, offer_snapshots, evaluations, purchases, money rules), spec/contracts/api.md §3 routes 2–9 and 12, §4, §5.1.

Implement spec/tasks.md T020–T045 and T050:
1. Pure apps/api/src/core (test-first, no I/O): money (strict decimal string -> bigint), normalizeOffer (domain, https-only URL, recurrence NONE/RECURRING/AMBIGUOUS), policy (rule pipeline, all rules run, decision fold, every reason code in api §5.1 incl. CURRENCY_UNKNOWN and RECURRENCE_UNCLEAR), mandateHash (exactly the 9 protected fields in architecture §9, golden vector), stateMachine. fast-check property tests UNIT-POL-05/06.
2. IntentParser: Gemini adapter (@google/genai, responseMimeType JSON + responseSchema, AI_MODEL/AI_API_KEY env, 10 s timeout), Zod .strict() re-validation, deterministic RuleBasedParser fallback. The LLM sees only the user's request text. Never guess quantity/budget -> clarificationQuestions.
3. Catalog: FixtureCatalogProvider (fictional .example merchants: allowed, over-budget, unapproved merchant, hidden subscription, ambiguous plan, missing price, look-alike domain). Channel3CatalogProvider: POST https://api.trychannel3.com/v1/search with x-api-key, 4 s timeout, <=20 results, 10-min cache, Zod mapping, drop malformed items, automatic fixture fallback. Report actual response fields observed.
4. /api/config returns merchantPresets (from active catalog) and the 3 scenarioPresets (AC-2.1, AC-8.3).
5. Routes 3–9 and 12: mandate create/confirm/version, search (one transaction), purchase create (re-evaluate, total + hash), approve (hash echo, 15-min TTL), cancel. CAS transitions -> 409; strict schemas -> 400 UNEXPECTED_FIELD; per-session rate limits per api §2.
6. e2e/api-flow.http covering the full API flow in fixture mode with the stub MCP.

Tests: UNIT-POL-01..06, UNIT-HASH-01, UNIT-MONEY-01, UNIT-SM-01, UNIT-NORM-01, UNIT-PARSE-01..06, INT-02, INT-04, INT-17, INT-26.
Run typecheck and tests; report results. No new dependencies without stating why.
```

**Exit check (G1):** full flow through HTTP in fixture mode; `core/` coverage ≥ 95 %.

---

## Stage 3 — Integrity: capture gate, audit chain, drift sim, seeder

```text
Continue IntentLock. Work only in the personal clone; never commit .env.

Read: spec/spec.md AC-5.2–5.6 and AC-6.2–6.5, spec/architecture.md §6.3, §6.5, §7.2, §10, spec/data-model.md (audit_events, purchases simulated_drift/seeded, §4 event types), spec/contracts/api.md routes 8, 11, 13–16, 21, 22 and §5.2, spec/security.md §3.

Implement spec/tasks.md T051–T058:
1. CaptureGate G1–G7: live order via MCP get_order with REST GET fallback (both fail -> 504, no capture). Reason codes: ORDER_MISMATCH, PAYPAL_NOT_APPROVED, DRIFT_AMOUNT_MISMATCH, CUSTOM_ID_MISMATCH, DRIFT_MERCHANT_MISMATCH, MANDATE_CHANGED, POLICY_NOW_BLOCKS, APPROVAL_EXPIRED. CAS ORDER_CREATED -> CAPTURING once, then REST capture with the stored request ID. Handle INSTRUMENT_DECLINED (back to ORDER_CREATED) and PENDING. Reconcile CAPTURING > 60 s on read (route 8).
2. audit_events: append-only (DB trigger), prev_hash + entry_hash per session, appended inside the caller's transaction with the session row locked. Write every event type in data-model §4 incl. PAYPAL_MCP_CALL, DRIFT_SIMULATED, DEMO_SEEDED; REQUEST_REJECTED for strict-schema rejections.
3. Routes 13–16: ledger (cursor, filters, approvalHashStatus, mcpTraceStatus), receipts with mcpTrace, chain verify with event count and first broken index.
4. Route 21 simulate-drift: only in ORDER_CREATED; stores an override the gate applies; never mutates stored rows; can only make capture fail.
5. Route 22 demo seed: fixed sample set, seeded=true, chained audit events, idempotent per session, zero PayPal/MCP calls.
6. Both demo controls return 404 when DEMO_CONTROLS_ENABLED=false.

Tests: INT-01, INT-03, INT-05..13, INT-16, INT-21..24, UNIT-AUD-01, SEC-01, SEC-03, SEC-08. INT-10 (concurrent capture) must prove exactly one capture call.
Run all tests; report results.
```

**Exit check:** a drift-blocked capture is in the audit chain, and `/audit/verify` returns `INTACT`.

---

## Stage 4 — Full UI, AG Grid ledger, AG Studio governance

```text
Continue IntentLock. Work only in the personal clone; never commit .env.

Read: spec/spec.md US-1..US-7 (UI ACs, NFR-7, NFR-9), spec/architecture.md §17, spec/contracts/api.md routes 18–19 and §4 schemas, spec/security.md T6/T7. Use github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate as a reference.

Implement spec/tasks.md T060–T06C:
1. Five-step guided flow: Request (3 scenario presets) -> Mandate editor (clarifications, merchant preset chips, confirm disabled until valid) -> Offers grouped by decision (reason chips, source badge) -> Approval (server values only, TTL countdown) -> PayPal checkout -> verified status. Badges: PayPal Sandbox, Simulated Drift, Sample data. Demo controls panel (tamper, drift toggle, sample history) clearly labelled as demo.
2. AG Grid Community ledger: Client-Side Row Model, getRowId, all AC-6.1 columns, text-only renderers (never dangerouslySetInnerHTML), quick filter. Row click -> Intent Receipt drawer (full chain of custody + MCP trace) + "Verify Audit Chain" button.
3. Route 18 analytics dataset.
4. AG Studio page: IntentLock theme tokens, default layout from architecture §17, custom widget "Mandate Integrity & MCP Gate" (chain status + event count, capture blocks by reason code, MCP call outcomes). Key from VITE_AG_STUDIO_KEY at build time; never committed.
5. Route 19 Governance Analyst: server-side Gemini function calling, SSE AG-UI events, tool-name allow-list (Studio dashboard tools only, no payment/MCP tools), 8-turn cap, rate limit, STUDIO_AGENT_ENABLED kill switch. Browser side uses clientToolRunner and delegate_to Studio built-in agents. Test 3 example questions.
6. Accessibility: labels, focus order, aria-live status.

Tests: INT-18, INT-19, INT-20, SEC-05, plus a manual run of E2E-01..17 on localhost.
Report what was verified and anything still unverified.
```

**Exit check (G2/G3):** E2E-01..17 pass manually on the hosted URL; the AG Studio agent adds a widget.

---

## Stage 5 — Ship and submit

```text
Continue IntentLock. Work only in the personal clone; never commit .env.

Read: spec/test-plan.md §4–§7, spec/submission.md (all), spec/plan.md §7–§9.

Implement spec/tasks.md T070–T076 and T081:
1. Playwright E2E for the mandatory judge scenarios (E2E-01, 02, 05, 10, 12, 14, 15, 16, 17) in fixture mode with MSW PayPal mock + stub MCP, plus axe scan (E2E-13). Run in CI.
2. OpenAPI 3.1 generated from Zod with a CI drift check; Postman collection with happy-path, tamper and drift requests.
3. Security sweep: SEC-04 (bundle secret grep), SEC-09, SEC-10, SEC-13 (fuzz).
4. Patch spec/ docs and .env.example for final decisions: Gemini adapter; no Docker (npm run dev + hosted Postgres URL); Render free tier with a keep-alive ping every 10 min; free-DB recreate + re-seed runbook for ~30 Nov.
5. Root README.md: problem, architecture diagram, setup in <=5 commands, env vars, "Judge Quickstart & Test Scenarios" (hosted URL, sandbox buyer login, 3 presets, drift toggle, sample-history seeder, expected-results table), how PayPal MCP is mediated, judging criteria -> evidence map, limitations, sponsor tools used, AG Studio trial note. TESTING.md from the last CI run (real counts only). THIRD_PARTY_NOTICES.md.
6. Output the Devpost story, Tools table, built-with tags, and a timed 2:50 video script with exact click paths for the recorder.

No speculative metrics or claims. Report all commands run and their results.
```

**Exit check (G4):** clean clone runs in ≤ 5 commands; video public; Devpost submitted; tag `v1.0.0-submission`.

### Manual steps after Stage 5
1. Live smoke checklist (`spec/test-plan.md` §6) on the hosted URL.
2. Clean-clone dry run in a private browser window.
3. Friend records the video from the script — real sandbox capture, drift block, AG Studio agent; no secrets on screen.
4. Upload video as **Public**, complete Devpost, tag `v1.0.0-submission`, submit by Wed 11 Nov 18:00 IST.
5. Calendar reminder: recreate + re-seed the free Render Postgres around 30 Nov.
