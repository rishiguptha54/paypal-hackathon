# IntentLock — Research Log and Decisions

> Facts verified against official documentation and aligned with our **6-day sprint baseline (29 Oct 2026)**. Each verified fact maps directly to an architectural or implementation decision.

## 1. Hackathon constraints (source: [official rules](https://paypalaihackathon.devpost.com/rules))

| Fact | Consequence for IntentLock |
|---|---|
| Official portal deadline is **Thu 12 Nov 2026, 12:00 PT**; internal 6-day sprint target is **04 Nov 2026**. | Ruthless P0 focus: build the end-to-end spine (AI Mandate → Policy Gate → PayPal MCP + Orders v2 Capture → AG Grid/Studio) first ([plan.md](plan.md)). |
| Must integrate PayPal developer platform (Sandbox) **and** an AI tool/model; PayPal must be **central**. | **PayPal MCP Server** mediation + **PayPal Orders v2** create → buyer approve → verified pre-capture gate is the spine of the product. |
| Stage One is pass/fail on theme fit and use of required APIs. | P0 = PayPal Sandbox + PayPal MCP Server + AI working end-to-end before any P2 stretch items. |
| Five equally weighted criteria: Technological Implementation, Design, Potential Impact, Innovation, Presentation. | Each criterion maps to an explicit artifact and demo checkpoint in [plan.md §6](plan.md#6-judging-criteria-coverage). |
| Functional demo required; a static prototype does **not** qualify. Hosted URL **or** complete run instructions. | Ship both: warm Render URL + `docker compose up` / `npm run dev` local quickstart. |
| Public repo with OSI license visible in the About section. | MIT `LICENSE` committed in Phase 0. |
| Video under 3 min, public on YouTube, no unlicensed music/trademarks. | Script and timing breakdown in [plan.md §7](plan.md#7-demo-video-script-under-3-minutes). |
| Must provide test credentials / sandbox logins needed to test. | Root `README.md` "Judge Quickstart" includes PayPal Sandbox buyer credentials and 1-click drift simulation presets. |
| Max **one** Sponsor Prize + one Grand or Honorable Mention. | Primary Sponsor Prize target: **AG Grid (via AG Studio + AG Grid Community)**; fallback narrative: **Channel3**. Render and Postman are used for hosting and API reproducibility. |
| Sponsor tools listed: AG Grid, APIMatic, Astropods, Bryntum, Channel3, Elastic, KERNEL, Postman, Render, Zapier. | Active stack: **AG Grid + AG Studio** (audit ledger + governance dashboard), **Channel3** (catalog discovery), **Render** (hosting + Postgres), **Postman** (contract & tamper test suite). |
| Honorable mentions include **Best Use of PayPal + AI** and **Best Use of Agentic Commerce**. | Positioning targets both by solving the #1 blocker in agentic commerce: buyer-side policy & drift enforcement over MCP payment tools. |
| Overview page requires a **"Tools" section**: name each AI model/service and explain how it is used. | Pre-written table maintained in [submission.md §4.3](submission.md#43-tools-field-required). |
| Judging "may utilize … automated AI-driven analysis". Judges may score **only from the description, images and video**. | Root `README.md` and Devpost text explicitly map every judging criterion to verifiable evidence, screenshots, and video timestamps. |
| Judge panel: PayPal developer advocates/engineers/PM plus one representative per sponsor. | PayPal judges will see native **PayPal MCP Server** mediation + **Orders v2** pre-capture security; AG Grid judges will see deep **AG Studio** custom widgets + `clientToolRunner` agent integration. |
| Testing access must stay free and unrestricted **until the judging period ends (15 Dec 2026)**. | Apply Render credits before free Postgres expiry so the hosted instance stays warm through 15 Dec ([submission.md §7](submission.md#7-judging-period-runbook-115-dec)). |
| Resources page highlights **PayPal MCP Server**, **PayPal Agent Toolkit**, and **PayPal JS SDK**. | Integrate the **PayPal MCP Server** as a core P0 component mediated by IntentLock's deterministic policy gate (see §2 below). |

## 2. PayPal & PayPal MCP Server

| Fact | Source | Decision |
|---|---|---|
| **PayPal MCP Server** (`@paypal/mcp` / official PayPal MCP tools) exposes structured tools for order creation (`create_order`), order inspection (`get_order`), and invoicing over the Model Context Protocol. | [PayPal AI & MCP Resources](https://paypalaihackathon.devpost.com/resources) | **Core P0 Architecture:** Never let the LLM invoke payment-mutating MCP tools directly. Instead, IntentLock's backend acts as a **Deterministic MCP Host/Mediation Layer**: after human mandate approval, IntentLock invokes the PayPal MCP Server `create_order` tool, and during the Pre-Capture Gate, invokes `get_order` to verify live order state against the `mandateHash`. Every MCP tool call and JSON-RPC trace summary is persisted in the **Intent Receipt**. |
| Orders v2 REST endpoints: `POST /v2/checkout/orders`, `GET /v2/checkout/orders/{id}`, `PATCH` (CREATED/APPROVED only), `POST …/authorize`, `POST …/capture`. Sandbox base `https://api-m.sandbox.paypal.com`; OAuth2 client credentials (`POST /v1/oauth2/token`). | [Orders v2](https://developer.paypal.com/api/orders/v2/) | Use intent `CAPTURE`. Pair the PayPal MCP Server adapter with typed direct `fetch` calls to Orders v2 so we retain 100% control over `PayPal-Request-Id` idempotency headers and capture `paypal-debug-id` response headers on every call (`NFR-8`). Never call `PATCH` after approval. |
| `PayPal-Request-Id` makes POSTs idempotent; same ID returns latest status instead of duplicating. Must be unique per request **and** per operation type; UUID recommended (≤ 38 chars). | [Idempotency](https://developer.paypal.com/api/rest/reference/idempotency/) | Store one deterministic UUID per `(purchaseId, operation)` in `payment_operations`. Serialize capture using DB compare-and-set (`UPDATE ... WHERE status = 'ORDER_CREATED'`) so concurrent requests never double-capture. |
| Checkout Frontend SDK: PayPal JS SDK v6 (`web-sdk/v6/core`) and Standard Checkout Buttons (`@paypal/react-paypal-js` / v5 `createOrder` + `onApprove`). Both invoke server-side order creation and server-side capture. PayPal's own best practices state: *"Never pass up item total from browser"* and *"Validate order details on your server before capture"*. | [JS SDK Setup](https://developer.paypal.com/sdk/js/) & [Standard Checkout](https://developer.paypal.com/studio/checkout/standard/integrate) | Decouple frontend button rendering from backend security: whether invoked via JS SDK v6 One-Time Payment Session or standard PayPal Checkout Buttons (`createOrder` → `/api/purchases/:id/paypal/create-order`, `onApprove` → `/api/purchases/:id/paypal/capture`), all amounts, MCP tool calls, and `mandateHash` checks happen strictly on the server. Cite PayPal's server-validation rule in README. |
| Funding failure returns `INSTRUMENT_DECLINED`; payer should be allowed to retry without duplicating the order. | Standard checkout guide | Keep purchase in `ORDER_CREATED`, write audit event `PAYPAL_INSTRUMENT_DECLINED`, and allow buyer retry on the existing order. |
| Webhooks: `CHECKOUT.ORDER.APPROVED`, `CHECKOUT.PAYMENT-APPROVAL.REVERSED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`. Requires HTTPS listener and RSA signature verification (`paypal-cert-url` pinned to `*.paypal.com`). | [Integrate webhooks](https://developer.paypal.com/api/rest/webhooks/rest/) | **Scoped as P2 Stretch (`US-9`).** Synchronous `POST .../capture` + pre-capture `get_order` verification is authoritative for the live demo. If time permits in Phase 5, enable `/api/webhooks/paypal` with `express.raw()` and event-ID deduplication. |
| Agent Ready (ACP, UCP) targets merchant-side checkout enablement on AI surfaces; Agentic Commerce Services require merchant onboarding. | [Agent Ready](https://developer.paypal.com/agent-ready/overview) | Position IntentLock as a **buyer-side policy & MCP governance gate** that complements merchant-side Agent Ready rails with zero gated onboarding dependency. |

## 3. Channel3

| Fact | Source | Decision |
|---|---|---|
| Developer API provides **Search** (natural language query + filters → ranked product offers) and **Lookup** (URL → structured offer). Native Checkout is early-access/coming soon. | [Channel3 developers](https://www.trychannel3.com/developers/) | Use Channel3 strictly for real-time product discovery (`PRODUCT_SOURCE=channel3`) behind a clean `CatalogProvider` interface with deterministic fixture fallback (`PRODUCT_SOURCE=fixture`). |
| Hackathon sponsor page provides free API access (`PAYPAL-HACKATHON-2026` = 20,000 credits). Projects must actively call the API to qualify. | [Channel3 sponsor page](https://paypalaihackathon.devpost.com/details/channel3) | Add a 10-minute in-memory/DB query cache on normalized search queries to conserve credits and guarantee sub-second repeat searches during judging (`NFR-2`). |
| Channel3 offers an MCP server for discovery. | Developer page | Keep catalog discovery in a deterministic server-side REST adapter (`POST https://api.trychannel3.com/v1/search` with `x-api-key` + 4s timeout) so untrusted product descriptions never enter an LLM tool loop (prompt-injection defense). |
| Recurrence/subscription is not a guaranteed first-class boolean on every merchant listing. | Developer page | Derive `recurring` deterministically in the normalization pipeline using an explicit keyword/regex scanner (`subscribe`, `monthly`, `auto-renew`, `membership`, `/mo`) over title and pricing metadata; if ambiguous, flag `NEEDS_REVIEW`. |

## 4. AG Grid & AG Studio (Primary Sponsor Prize Target)

| Fact | Source | Decision |
|---|---|---|
| React grid installs as `ag-grid-react` + `ag-grid-community` (matching versions). Client-Side Row Model is free in Community and ideal for session-scoped audit ledgers (< 5,000 rows). | [AG Grid React Docs](https://www.ag-grid.com/react-data-grid/installation/) | Use AG Grid Community (Client-Side Row Model) for the **Audit Ledger (`US-6`)**. Render custom status badges for `ALLOWED`/`BLOCKED`/`BLOCKED_AT_CAPTURE`, `mandateHash` status, and **PayPal MCP tool trace badges** using safe React text components (never `dangerouslySetInnerHTML`). |
| **The "Best Use of AG Grid" prize is judged heavily on AG Studio**: custom widgets, custom theming, layout tools, and the **Studio Agent Framework** (`github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate`). Free 45-day trial license available. | [AG Grid sponsor page](https://paypalaihackathon.devpost.com/details/aggrid) | **Core P0 Deliverable (`US-7`):** Build the **IntentLock Governance Studio** using AG Studio, custom theme tokens, and a custom **Mandate Integrity & MCP Gate** widget. Inject the trial key via environment variable (`VITE_AG_STUDIO_KEY`) at build time so no secret is committed to Git. |
| Studio Agent Framework supports `clientToolRunner` (`run: (input, ctx) => myServer.stream(input)`), keeping LLM API keys on the backend while Studio executes UI widget mutations in the browser via the AG-UI protocol. | [AG Studio AI Agents](https://www.ag-grid.com/studio/react/ai-agents/) | Implement the **Governance Analyst** agent via `clientToolRunner`. Strictly scope its allow-listed tools to read-only audit aggregation and dashboard widget creation (`delegate_to` Studio's built-in layout/chart agents). It has zero access to mandate approval or PayPal MCP tools. |

## 5. Render

| Fact | Source | Decision |
|---|---|---|
| Single Web Service can serve both the Node/TypeScript API and the compiled Vite SPA from the same origin (`0.0.0.0:$PORT`), eliminating CORS and cross-site cookie issues. | [Render Web Services](https://render.com/docs/web-services) | Deploy a unified single-service architecture (`render.yaml` Blueprint in repo root) backed by Render Managed PostgreSQL. |
| Free web services spin down after 15 min idle (~60s cold start); free Postgres expires after 30 days. Render provides $50 in hackathon credits on the sponsor page. | [Render Free Tier](https://render.com/docs/free) & [Render Sponsor Page](https://paypalaihackathon.devpost.com/details/render) | Claim the $50 Render credit and run the production demo on a warm starter instance + persistent Postgres through **15 Dec 2026** so judges never hit a 60-second cold start (`NFR-11`). |

## 6. AI provider & Prompt-Injection Isolation

| Consideration | Decision |
|---|---|
| Strict JSON schema adherence required for draft mandate extraction. | Implement `IntentParser` interface with an OpenAI-compatible Structured Outputs adapter (`response_format: json_schema`, configured via `AI_MODEL` / `AI_API_KEY`) plus a deterministic fallback parser so tests and offline demos never break. Re-validate all outputs with Zod `.strict()`. |
| Indirect prompt injection via malicious product titles/descriptions from web catalogs. | **Strict Air-Gap:** The LLM **only** processes the buyer's initial natural-language request to draft a mandate (`US-1`). Catalog offers (`US-3`), policy evaluation (`FR-07`), `mandateHash` calculation (`FR-08`), and **PayPal MCP Server** calls (`FR-10`/`FR-11`) are executed 100% by deterministic server code. Product text never enters an LLM prompt. |
| Predictable latency & cost. | Exactly **one** LLM call per mandate draft (`US-1`), and optional user-triggered turns in the read-only AG Studio Governance Analyst (`US-7`). Zero LLM calls in the offer evaluation or PayPal checkout loop. |

## 7. Alternatives considered

| Option | Rejected because |
|---|---|
| Let the LLM call PayPal MCP Server tools directly in an autonomous agent loop | Violates Rule #1 ("The LLM never authorizes money"). Vulnerable to prompt injection, hallucinated quantities, and unapproved captures. IntentLock mediates PayPal MCP tools deterministically instead. |
| Separate Static Site + API Service on Render | Introduces CORS preflights, `SameSite=None` cookie complexity, and dual build pipelines during a 6-day sprint. |
| SQLite on ephemeral Render disk | Wiped on every redeploy unless attached to a paid persistent disk; PostgreSQL provides transactional integrity and atomic compare-and-set state locking. |
| LLM evaluates whether offers match the mandate | Non-deterministic, slow, expensive, and impossible to prove mathematically in an audit receipt. Pure TypeScript policy functions are instant and 100% testable. |
| `intent=AUTHORIZE` then separate capture flow | Adds multi-step authorization lifecycle management without improving the pre-capture drift demonstration; `intent=CAPTURE` with our pre-capture `get_order` + `mandateHash` gate achieves the exact security guarantee cleanly. |
| Asynchronous webhooks as primary payment confirmation | Webhook delivery can lag; synchronous capture response verified against `get_order` provides immediate, deterministic truth for the user and demo. |

## 8. Resolved pre-build decisions (formerly open questions)

| # | Topic | Final Decision Locked for 6-Day Sprint |
|---|---|---|
| D1 | **PayPal API & MCP Transport** | Use an explicit `PayPalMcpGateway` module that executes official **PayPal MCP Server** tool calls (`create_order`, `get_order`) for order creation and pre-capture inspection, paired with direct typed `fetch` to PayPal Orders v2 REST (`/v2/checkout/orders/{id}/capture`) to guarantee `PayPal-Request-Id` idempotency and capture `paypal-debug-id` headers. |
| D2 | **PayPal Checkout Frontend** | Support PayPal Checkout via a clean server-driven hook (`/api/purchases/:id/paypal/create-order` and `/api/purchases/:id/paypal/capture`) compatible with both PayPal JS SDK v6 One-Time Payment Sessions and `@paypal/react-paypal-js` buttons. |
| D3 | **Channel3 Catalog Resilience** | Implement `Channel3CatalogProvider` with a 4,000 ms timeout and 10-min cache, plus automatic or env-toggled fallback to `FixtureCatalogProvider` containing curated office procurement offers (allowed, over-budget, unapproved merchant, hidden subscription, and missing price) so every policy reason code can be demonstrated reliably. |
| D4 | **AG Studio License Hygiene** | Never hardcode the AG Studio trial key in source files. Read from `VITE_AG_STUDIO_KEY` in `.env` (gitignored) and Render Environment Variables; provide the key to judges in the private Devpost testing notes. |
| D5 | **Judge Cold-Start Experience** | Include a 1-click **"Load Sample Procurement History"** seeder (`AC-6.5`) and a **"Simulate Post-Approval Drift"** toggle (`AC-5.6`) in the UI so judges can verify both the pre-capture PayPal gate and the AG Studio dashboard in under 3 minutes. |