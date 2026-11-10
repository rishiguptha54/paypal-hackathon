# IntentLock — Task Breakdown

> Ordered by dependency. `[P]` = can run in parallel with the previous task. Role letters from [plan.md §2](plan.md#2-roles-merge-if-the-team-is-smaller). "Verify" = test IDs from [test-plan.md](test-plan.md) or an explicit check. Sprint days per [plan.md §3](plan.md#3-schedule) (Day 1 = Fri 30 Oct, Day 6 = Wed 4 Nov). Give Copilot **one task at a time** with its row and the linked spec sections.

## Phase 0 — Foundation (pre-sprint, 26–28 Oct)

| ID | Task | Role | Depends | Verify |
|---|---|---|---|---|
| T000 | **Admin (pre-sprint):** every member does the employer/IP check; all register on Devpost and join one team (pick the Representative); join the PayPal Discord; get a Channel3 key + promo `PAYPAL-HACKATHON-2026`; claim the $50 Render credit; choose an AI provider and set a hard spend cap; watch the PayPal and AG Grid webinars | All | — | [submission.md §2](submission.md#2-compliance-matrix-all-must-be--before-submitting) rows C15–C16 |
| T001 | Create public repo, MIT `LICENSE`, `.gitignore` (incl. `.env*` except `.env.example`), README skeleton | D | — | License shows in GitHub About |
| T002 | npm workspaces: `apps/web`, `apps/api`, `packages/shared`; strict `tsconfig` base; ESLint + Prettier | D | T001 | `npm run typecheck` passes |
| T003 | `apps/api`: Express 5 server, `config.ts` (Zod env, fails fast, `PAYPAL_ENV=sandbox` guard), pino with redaction, requestId, error envelope, helmet, JSON-only + 16 KB limit | B | T002 | UNIT-CFG-01, SEC-02, SEC-11, SEC-12 |
| T004 | Hosted Postgres URL (no Docker), Drizzle setup, first migration (`sessions`), `/api/health` with DB ping | D | T003 | Health 200 on two machines |
| T005 | Signed anonymous session middleware (`il_sid`) | B | T004 | Cookie flags asserted |
| T006 | `apps/web`: Vite + React + TS shell, typed API client, `/api/config` fetch; Express serves built SPA in prod | C | T002 | Page loads from API origin |
| T007 | GitHub Actions: install, typecheck, lint, unit, integration (Postgres service), gitleaks, `npm audit --omit=dev` | D | T004 | CI green |
| T008 | `.env.example` with `<REPLACE_ME>` placeholders for every variable in [architecture.md §12](architecture.md#12-configuration) (incl. `PAYPAL_MCP_COMMAND`, `VITE_AG_STUDIO_KEY`, `DEMO_CONTROLS_ENABLED`); `.github/copilot-instructions.md` from blueprint §12 | D | T003 | No real values in repo |

## Phase 1 — PayPal MCP + Orders v2 slice (Day 1–2, 30–31 Oct) → **G0**

| ID | Task | Role | Depends | Verify |
|---|---|---|---|---|
| T010 | Sandbox app + business/buyer accounts; record (privately) client ID/secret | A | — | Can obtain OAuth token |
| T011 | `adapters/paypal` (REST): OAuth token cache, `captureOrder`, `getOrder` (gate fallback), `createOrder` (MCP-unavailable fallback) with `PayPal-Request-Id`, 15 s timeout, `paypal-debug-id` capture, typed response mapping (Zod) | A | T003, T010 | Unit tests with mocked fetch |
| T015 | `adapters/paypalMcp` — `PayPalMcpGateway`: launch the pinned official PayPal MCP Server over stdio (`PAYPAL_MCP_COMMAND`) with a short-lived sandbox token; list tools at startup and fail health if `create_order`/`get_order` are missing; allow-list exactly those two; Zod-validate results; 15 s timeout; return trace summary. Add a stub MCP server for tests | A | T011 | UNIT-MCP-01, INT-25 |
| T012 | Migration: `purchases` (minimal), `payment_operations` (incl. `channel`, `mcp_tool`); temporary route to create $1.00 purchase | A | T004 | — |
| T013 | Web: PayPal **JS SDK v6** one-time payment session or `@paypal/react-paypal-js` buttons; `createOrder` → `/paypal/create-order`, `onApprove` → `/paypal/capture` (ADR-012); add route 20 only if the v6 path needs a client token; CSP allows the PayPal SDK hosts | C | T006, T011 | Popup opens; no CSP errors |
| T014 | Live sandbox run: MCP `create_order` → buyer approves → MCP `get_order` → REST capture; cancel path | A+C | T011–T015 | **G0**: stored status `COMPLETED` = live order status |

## Phase 2 — Pure core, test-first (Day 1–2, 30–31 Oct) [P with Phase 1]

| ID | Task | Role | Depends | Verify |
|---|---|---|---|---|
| T020 | `packages/shared`: Zod schemas (`MandateFields`, `OfferSnapshot`, `Evaluation`, `Purchase`, `Money`, `ScenarioPreset`), `reasonCodes.ts` with templates | B | T002 | Types compile in web + api |
| T021 | `core/money` (bigint minor units, strict parse/format) | B | T020 | UNIT-MONEY-01 |
| T022 | `core/normalizeOffer` (domain, https URL, price, recurrence keyword_v1 with `AMBIGUOUS`) | B | T021 | UNIT-NORM-01 |
| T023 | `core/policy` rule pipeline + decision fold + `POLICY_VERSION` (incl. `CURRENCY_UNKNOWN`, `RECURRENCE_UNCLEAR`) | B | T021, T022 | UNIT-POL-01..06 |
| T024 | `core/mandateHash` canonical serializer over the 9 protected fields + golden vector | B | T020 | UNIT-HASH-01 |
| T025 | `core/stateMachine` transition table (purchase + mandate) | B | T020 | UNIT-SM-01 |

## Phase 3 — Mandate + AI (Day 2–3, 31 Oct – 1 Nov)

| ID | Task | Role | Depends | Verify |
|---|---|---|---|---|
| T030 | Migration `mandates`; `MandateService` (create, confirm, version/supersede) | B | T005, T020 | INT (create/confirm) |
| T031 | `IntentParser` interface; `RuleBasedParser` (port prototype regexes, extend) | B | T030 | UNIT-PARSE-01..05 |
| T032 | `LlmIntentParser`: structured JSON output, system prompt (user text only), 10 s timeout, Zod re-validation, fallback to rule parser on failure | B | T031 | UNIT-PARSE-06, live smoke |
| T033 | Routes 3–5 (`/mandates*`) with rate limit 10/min | B | T030–T032 | SEC-01, SEC-06 |

## Phase 4 — Discovery + evaluation (Day 3, 1 Nov)

| ID | Task | Role | Depends | Verify |
|---|---|---|---|---|
| T040 | `CatalogProvider` interface; `FixtureCatalogProvider` with the demo offers (allowed, over-budget, unapproved merchant, hidden subscription, ambiguous plan, missing price, look-alike domain), using **fictional `.example` merchants and product names** (safe for video trademarks) | B | T022 | Fixture contract test |
| T041 | Channel3 check: confirm the response fields of `POST /v1/search` against [research.md §3](research.md#3-channel3); note differences in the adapter mapping | B | — | Mapping test from a recorded response |
| T042 | `Channel3CatalogProvider`: 4 s timeout, ≤ 20 results, 10-min cache, Zod-validated mapping, drop malformed items, automatic fallback to fixtures (research D3) | B | T040, T041 | INT-17, INT-12 |
| T043 | Migrations `offer_snapshots`, `evaluations`; `OfferService.search` (one transaction) + route 6 | B | T023, T042 | INT search |
| T044 | **G1** API-level run in fixture mode with stub MCP (script in `e2e/api-flow.http` or Postman) | B+A | T014, T043 | **G1** |
| T045 | `/config`: `merchantPresets` from the active catalog source (fixture `.example` domains in fixture mode) and the 3 `scenarioPresets` (AC-2.1, AC-8.3) | B | T040 | INT-26 |

## Phase 5 — Integrity (Day 3–4, 1–2 Nov)

| ID | Task | Role | Depends | Verify |
|---|---|---|---|---|
| T050 | `PurchaseService`: create (re-evaluate, compute total + hash), approve (hash echo, TTL), cancel; CAS transitions; routes 7–9, 12 | A | T023–T025, T043 | INT-02, INT-03, INT-04 |
| T051 | `/paypal/create-order` route (10): get-or-create `payment_operations(CREATE_ORDER)`; call `PayPalMcpGateway.create_order` with server-stored values; `custom_id`/`invoice_id` = purchaseId; audit `PAYPAL_MCP_CALL` | A | T050, T015 | INT-01 (create part), INT-22 |
| T052 | `CaptureGate` G1–G7: live order via MCP `get_order` with REST fallback; reason codes incl. `DRIFT_AMOUNT_MISMATCH` / `DRIFT_MERCHANT_MISMATCH`; REST capture with stable request ID; result mapping incl. `INSTRUMENT_DECLINED`, `PENDING`; route 11 | A | T051 | INT-05..11, INT-13, INT-21 |
| T053 | Reconcile-on-read for `CAPTURING` > 60 s via `get_order` (route 8) | A | T052 | INT-16 |
| T054 | Migration `audit_events` (`prev_hash`, `entry_hash`) + trigger; `AuditService.append` inside caller tx; per-session hash chain; wire all event types from [data-model.md §4](data-model.md#4-audit-event-types) incl. `PAYPAL_MCP_CALL` | B | T030 | UNIT-AUD-01, SEC-08 |
| T055 | Strict-schema rejection auditing (`REQUEST_REJECTED`) | B | T054 | SEC-01, E2E-10 |
| T056 | Routes 13–16: ledger (cursor; approval-hash and MCP-trace status columns), receipts with `mcpTrace`, chain verify with event count | B | T054 | INT ledger |
| T057 | Drift simulation (route 21): `simulated_drift` column, CaptureGate applies override, `DRIFT_SIMULATED` audit, `DEMO_CONTROLS_ENABLED` switch | A | T052, T054 | INT-23 |
| T058 | Demo seeder (route 22): fixed sample set (allowed captures, drift blocks, unapproved merchants, subscription blocks), `seeded=true`, chained audit events, idempotent per session, no PayPal/MCP calls | B | T054, T056 | INT-24 |

## Phase 6 — UI (Day 3–5, 1–3 Nov)

| ID | Task | Role | Depends | Verify |
|---|---|---|---|---|
| T060 | Step header + request screen with 3 scenario presets + mandate editor (clarifications, merchant preset chips + custom domain, confirm disabled until valid) | C | T033, T045 | E2E-06, E2E-17 |
| T061 | Offers grouped by decision; reason chips; source badge (`Live: Channel3` / `Fixture Catalog`); only ALLOWED selectable | C | T043 | E2E-02..05 |
| T062 | Approval screen (server values only, TTL countdown) → PayPal checkout (JS SDK v6 or react-paypal-js) → verified status screen with `PayPal Sandbox` badge | C | T050–T052 | E2E-01, E2E-08, E2E-09, E2E-11 |
| T063 | AG Grid Community ledger: typed `colDefs` for all AC-6.1 columns (incl. approval-hash status, MCP trace status, catalog source), `getRowId`, sort/filter, text-only renderers, `Sample data` badge, quick filter | C | T056 | E2E-12, SEC-05 |
| T064 | Intent Receipt drawer (full chain of custody incl. MCP trace) + "Verify Audit Chain" button with event count | C | T056 | E2E-12 |
| T065 | Demo controls, clearly labelled: tamper demo (sends extra `total` field), "Simulate Post-Approval Drift" toggle with `Simulated Drift` badge, "Load Sample Procurement History" button | C | T055, T057, T058 | E2E-10, E2E-15, E2E-16 |
| T066 | A11y: labels, focus order, `aria-live` status; axe in Playwright | C | T060–T065 | E2E-13 |

## Phase 6c — Governance Studio, AG Studio (P0 sponsor track, Day 3–6, 1–4 Nov)

| ID | Task | Role | Depends | Verify |
|---|---|---|---|---|
| T067 | Activate the AG Studio 45-day trial on **Sun 1 Nov** (record the expiry); put the key in `VITE_AG_STUDIO_KEY` (`.env` + Render), never in source (research D4); clone the official PayPal + AG Studio boilerplate as a reference | C | T000 | Expiry ≥ 16 Dec |
| T068 | `GET /analytics/dataset` (route 18) from evaluations + purchases + audit, incl. `captureBlockCodes`, `mcpTraceStatus`, `seeded` | B | T056 | INT-18 |
| T069 | AG Studio page: IntentLock theme tokens, default saved layout (§17 widgets), data bound to route 18 | C | T067, T068 | Renders real or seeded session data |
| T06A | Custom **Mandate Integrity & MCP Gate** widget (chain status + event count from `/audit/verify`, pre-capture block counts by violation code, MCP call outcomes) | C | T069 | E2E-14 |
| T06B | `POST /studio-agent/turn` (route 19): SSE AG-UI events, tool-name allow-list, 8-turn cap, rate limit, kill switch | B | T032 | INT-19, INT-20 |
| T06C | Governance Analyst agent via `clientToolRunner`, delegating to Studio built-in agents; 3 tested example prompts | C | T06B, T069 | E2E-14 (LLM mocked) + live check |

## Delivery track (Day 1–6, then hardening 5–8 Nov)

Final delivery decisions: Gemini adapter, native Node (no Docker), Render free
service with ten-minute health pings and expiry-tracked free Postgres replacement.
T073 live smoke/video and T074 P2 webhooks remain deferred; no hosted gates or
submission are asserted by the local implementation.

| ID | Task | Role | Depends | Verify |
|---|---|---|---|---|
| T070 | Native Node `render.yaml` (no Docker), free web service + hosted free Postgres URL, pinned MCP dependency, startup migration (free services have no pre-deploy hook), health path, build-time Studio license; 10-minute ping + DB replacement runbook | D | T004 | Hosted smoke pending; disclose free-tier cold-start/expiry risks |
| T071 | Judge scenario presets content: the 3 presets (Happy Path, Blocked Offer, Pre-Capture Drift) + expected-outcome table shared by `/config` and README | D | T045 | E2E-17 |
| T072 | Stage 5 mandatory Playwright scenarios E2E-01, 02, 05, 10, 12–17 with MSW Sandbox REST + intercepted SDK + stub MCP; CI | D | T060–T066, T06A | Nine browser tests cover these IDs; remaining E2E-03, 04, 06–09, 11 are not claimed |
| T073 | Live smoke on hosted URL (test-plan §6), record evidence; **record the backup video cut** | D+A | T070, T072 | **G2** |
| T074 | **P2 (US-9), only after G3 and P7 items are green:** webhook route (raw body), self-verification, cert host pin, dedupe, transitions; subscribe the 5 events in [research.md §2](research.md#2-paypal--paypal-mcp-server) | A | T052 | INT-14, INT-15, SEC-07 |
| T075 | OpenAPI 3.1 generated from shared Zod 4 (`zod-openapi`) + CI drift check; Postman collection with happy-path, tamper and drift requests | D | T056, T057 | FR-19 (P1) |
| T076 | Security sweep: SEC-03, 04, 09, 10, 13 (fuzz) | D | T072 | SEC-* |

## Phase 8 — Release (9–11 Nov)

| ID | Task | Role | Depends | Verify |
|---|---|---|---|---|
| T080 | Feature freeze; triage only P0 bugs | All | — | — |
| T081 | README final (setup ≤ 5 commands, **Judge Quickstart & Test Scenarios** with the 3 presets, drift toggle, sample-history seeder and expected outcomes, criteria→evidence map, limitations, sponsor usage, PayPal MCP mediation explained, AG Studio trial note), `TESTING.md` from last CI run, `THIRD_PARTY_NOTICES.md` | D | T072 | — |
| T082 | Clean-clone dry run by a non-author + judge-eye run in a private window | D | T081 | **G4** |
| T083 | Record + edit video per [plan.md §7](plan.md#7-demo-video-script-under-3-minutes) and [submission.md §6](submission.md#6-video-production-checklist); captions; frame-check for secrets/trademarks; upload **Public** | All | T073 | < 3:00, plays logged-out |
| T084 | Devpost: story, **Tools** table, built-with tags, 5–7 gallery images, links; all team members attached; tag `v1.0.0-submission` and link the tag | Lead | T082, T083 | Submitted by 11 Nov 18:00 IST |

## After submission (13 Nov – 21 Dec)

| ID | Task | Role | Depends | Verify |
|---|---|---|---|---|
| T090 | Freeze `main` at the submission tag; further work on a branch only | Lead | T084 | Branch protection on |
| T091 | Verify free Render usage/health, 10-minute pings, free-DB expiry and ~30 Nov replacement; external uptime monitor + two alert recipients | D | T070 | Live smoke and actual expiry recorded; no guaranteed uptime |
| T092 | Live smoke on 1 Dec and ~8 Dec; daily health glance until 15 Dec | D | T091 | Logged results |
| T093 | After 21 Dec: rotate all keys and the judge sandbox password; downgrade paid plans | D | — | — |

## Copilot prompt template for a task

```text
Implement task <ID> from spec/tasks.md only.
Read: spec/architecture.md §<n>, spec/data-model.md §<n>, spec/contracts/api.md §<n>.
Constraints: follow .github/copilot-instructions.md; money as bigint minor units; strict Zod schemas;
no client-trusted amounts; no new dependencies without stating why.
Deliver: code + tests <test IDs>. Run typecheck and tests; report exact commands and results.
If an external API detail is unverified, stop and list the question instead of guessing.
```
