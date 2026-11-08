# IntentLock — Product Specification

> Defines **what** IntentLock must do. Implementation lives in [architecture.md](architecture.md). Every requirement has an ID that tests ([test-plan.md](test-plan.md)) and tasks ([tasks.md](tasks.md)) reference.

## 1. Problem

AI shopping agents can find products quickly, and tool ecosystems like the **PayPal MCP Server** now allow AI agents to create and inspect PayPal orders directly. However, **a recommendation is not an authorization**, and giving an LLM unmediated access to payment-mutating tools is unsafe. Between the user's request and the final payment capture, the order can silently drift: a higher total, an unapproved seller, a bundled subscription, or a modified quantity. Existing agentic-commerce rails (PayPal Agent Ready, ACP, UCP) focus on **merchant-side** checkout enablement; the buyer still needs an independent, deterministic policy gate that mediates **PayPal MCP Server** and **PayPal Orders v2** execution to prove the final order matches what they agreed to.

## 2. Target user

**Primary:** A small-business owner or team lead who delegates routine procurement research (office supplies, hardware, accessories) to an AI assistant but must keep spend inside explicit policy limits and prove *why* a purchase was allowed or blocked.

**Secondary (judges/reviewers):** Reviewers who need to reproduce both the happy-path PayPal Sandbox checkout and live drift/tamper rejection scenarios from a clean clone or hosted URL—and verify the guardrail is enforced by deterministic code, not scripted.

## 3. Value proposition

IntentLock converts a natural-language request into a structured **purchase mandate**, evaluates product offers against it using deterministic rules, mediates **PayPal MCP Server** tool calls (`create_order`, `get_order`), and only allows a PayPal Sandbox order to be captured if the live PayPal order record still matches the cryptographically locked mandate. Every decision, MCP tool invocation, and capture check produces an immutable audit record.

**Differentiator (stated as hypothesis, not as absolute novelty):** Acting as a deterministic buyer-side policy gate in front of the **PayPal MCP Server** and **PayPal Orders v2 API**—binding a human-confirmed mandate to a specific PayPal order via a canonical SHA-256 `mandateHash`, and re-verifying live PayPal order state immediately before capture.

## 4. Glossary

| Term | Meaning |
|---|---|
| **Request** | The raw natural-language text the user types. |
| **Draft mandate** | AI-extracted, schema-validated constraints. Editable. Not yet authoritative. |
| **Mandate** | Draft confirmed by the user. Immutable after confirmation (editing creates a new `mandateVersion`). |
| **Offer snapshot** | Normalized, server-stored copy of the product/offer fields used for a policy decision. |
| **Evaluation** | Output of the pure policy function: `ALLOWED` / `BLOCKED` / `NEEDS_REVIEW` + structured reason codes. |
| **Purchase** | One selected `ALLOWED` offer + quantity + server-computed total, moving through the payment state machine. |
| **Mandate hash** | SHA-256 over canonical JSON of protected fields: `mandateId`, `mandateVersion`, `offerId`, `merchantDomain`, `quantity`, `unitPriceMinor`, `totalMinor`, `currency`, and `recurring`. Locks user approval to the exact order. |
| **PayPal MCP Adapter** | Server-side mediation layer that invokes official **PayPal MCP Server** tools (`create_order`, `get_order`) only after policy and `mandateHash` checks pass, with structured fallback/verification against PayPal Orders v2 REST endpoints. |
| **Intent Receipt** | Human-readable audit view linking request → mandate → evaluation → approval → PayPal MCP trace → PayPal capture result. |

## 5. User stories and acceptance criteria

Format: *Given / When / Then*. Priority: **P0** = required for submission & target sponsor prizes, **P1** = should ship, **P2** = stretch / only if time allows.

### US-1 Describe a purchase (P0)
As a buyer, I type what I want in plain English so I don't have to fill out a complex procurement form from scratch.
- **AC-1.1** Given a request containing item, quantity, and maximum total, when I submit, then I see a draft mandate with each field populated and editable within 10 s (NFR-2).
- **AC-1.2** Given a request missing quantity or maximum total, then the draft is marked `NEEDS_CLARIFICATION` with a specific prompt per missing field; nothing is guessed or defaulted.
- **AC-1.3** Given the request implies no recurring commitments ("no subscriptions", "one-time"), then `recurringAllowed = false`. If unmentioned, default is `false` (fail closed).
- **AC-1.4** Given the AI provider fails or returns schema-invalid output, then I see a clear error banner and can complete the mandate form manually; no unvalidated data reaches the policy engine.

### US-2 Confirm the mandate (P0)
As a buyer, I review and confirm the rules so that the agent and payment layer are bound by what I approved, not by what the LLM inferred.
- **AC-2.1** Confirm is disabled until all required fields are valid (quantity 1–100, max total > 0, currency `USD`, ≥1 approved merchant domain). To prevent cold-start friction, the UI provides clickable **Merchant Preset Chips** mapped to known catalog domains (e.g., `staples.com`, `logitech.com`, `dell.com`, `bestbuy.com`) alongside custom domain entry.
- **AC-2.2** After confirmation, the mandate is immutable; editing creates a new `mandateVersion` and invalidates prior evaluations and uncaptured approvals.

### US-3 Discover and evaluate offers (P0)
As a buyer, I see product offers sorted into `ALLOWED` / `BLOCKED` / `NEEDS_REVIEW` with exact deterministic reasons.
- **AC-3.1** Offers come from Channel3 when `PRODUCT_SOURCE=channel3`; otherwise from deterministic catalog fixtures. The UI displays a visible **Source Badge** (`Live: Channel3` / `Fixture Catalog`).
- **AC-3.2** Each offer displays its decision + structured reason codes + a one-line human explanation (defined in [contracts/api.md §5](contracts/api.md#5-policy-reason-codes)).
- **AC-3.3** Only `ALLOWED` offers are selectable for checkout. `NEEDS_REVIEW` (e.g., missing price/currency/recurring metadata) and `BLOCKED` offers cannot be purchased.
- **AC-3.4** Every offer evaluation (including blocks and needs-review) is written to the audit log.

### US-4 Approve a specific order (P0)
As a buyer, I explicitly approve one exact order (item, merchant domain, quantity, unit price, total, currency) before any PayPal order is created.
- **AC-4.1** The approval screen displays **server-computed** integer minor-unit values only.
- **AC-4.2** Approval records the canonical `mandateHash`, `approvedAt`, and `approvalExpiresAt` (default 15 minutes).
- **AC-4.3** Any client request that includes an unexpected client-supplied amount, total, or decision override field is rejected with `400 UNEXPECTED_FIELD` and logged to the audit chain (client-tamper protection).

### US-5 Pay with PayPal MCP Server & PayPal Sandbox (P0)
As a buyer, I complete payment through PayPal Sandbox knowing IntentLock verifies the live order via the PayPal MCP Server and Orders v2 gate before capture.
- **AC-5.1** Only after human approval (`APPROVED` state), IntentLock invokes the **PayPal MCP Server** `create_order` tool (backed by PayPal Orders v2 `POST /v2/checkout/orders` with `PayPal-Request-Id`) using the server-stored total, `custom_id = purchaseId`, and `invoice_id = purchaseId`. The MCP tool invocation metadata is recorded in the audit log.
- **AC-5.2** Immediately before capture, the server executes the **Pre-Capture Verification Gate**: it queries the live PayPal order state via the **PayPal MCP Server** `get_order` tool (and Orders v2 `GET /v2/checkout/orders/{id}`), verifies PayPal status is `APPROVED`, checks that `amount`, `currency`, and `custom_id` match the stored purchase, recomputes the `mandateHash` against current offer/purchase state, re-runs deterministic policy, and verifies `now < approvalExpiresAt`. Any mismatch aborts capture and transitions the purchase to `BLOCKED_AT_CAPTURE` with an explicit reason code (`DRIFT_AMOUNT_MISMATCH`, `DRIFT_MERCHANT_MISMATCH`, `APPROVAL_EXPIRED`, etc.).
- **AC-5.3** Capture is strictly idempotent: double-clicks, network retries, or duplicate requests with the same `purchaseId` yield at most one PayPal capture call.
- **AC-5.4** Order success is shown only when PayPal returns capture status `COMPLETED`. `PENDING` is displayed as pending. Client redirect parameters alone are never trusted as proof of payment.
- **AC-5.5** Buyer cancellation inside the PayPal checkout popup transitions the purchase to `CANCELLED` with zero capture attempt.
- **AC-5.6 (Judge Drift / Tamper Simulation Mode):** On the checkout/capture review panel, reviewers can trigger a safe **"Simulate Post-Approval Drift"** toggle (simulating a pre-capture price hike, merchant domain swap, or expired approval TTL) to observe IntentLock's pre-capture gate actively block capture (`BLOCKED_AT_CAPTURE`) and log the forensic audit event in real time.

### US-6 Inspect the audit ledger (P0 — AG Grid Sponsor Focus)
As a buyer or judge, I can sort, filter, and inspect every decision and PayPal MCP trace in an enterprise-grade ledger.
- **AC-6.1** AG Grid ledger with columns: timestamp, product, merchant domain, decision, reason codes, approval hash status, PayPal order ID, MCP tool trace status, capture status, and catalog source.
- **AC-6.2** Clicking any row opens the **Intent Receipt** drawer showing the full chain of custody: raw request → confirmed mandate → offer snapshot → policy findings → human approval & `mandateHash` → PayPal MCP tool request/response summary → final PayPal capture/block status → hash-chain verification badge.
- **AC-6.3** Records persist across server restarts in PostgreSQL/SQLite.
- **AC-6.4** A **"Verify Audit Chain"** button recomputes the SHA-256 hash chain across all session events and reports `INTACT` (with verified event count) or highlights the exact index of the first tampered event.
- **AC-6.5 (One-Click Demo Seeder):** New browser sessions include a **"Load Sample Procurement History"** action that seeds realistic historical events (allowed captures, blocked drift attempts, unapproved merchants, subscription blocks) into the current session so judges can immediately test AG Grid filtering and AG Studio analytics without running 10 manual checkouts first.

### US-7 See governance at a glance (P0 — Required for AG Grid / AG Studio Sponsor Prize)
As a business owner, I want an interactive analytics dashboard and governance assistant that show whether AI procurement stays inside policy.
- **AC-7.1** An **AG Studio** dashboard styled with the IntentLock theme loads a default multi-widget governance layout powered by the session's real (or demo-seeded) audit dataset ([architecture.md §17](architecture.md#17-governance-studio-ag-studio)).
- **AC-7.2** A custom **Mandate Integrity & MCP Gate** widget displays audit hash-chain health alongside pre-capture block counts broken down by violation code.
- **AC-7.3** I can ask the **Governance Analyst** agent a question in plain English (e.g., *"Break down blocked offers by merchant domain and reason code"*), and it dynamically adds or updates dashboard widgets. It has zero permissions to mutate mandates, purchases, or PayPal orders.
- **AC-7.4** All charts and KPIs derive strictly from stored database events; no hardcoded or invented metrics.

### US-8 Reproduce as a judge (P0)
- **AC-8.1** From a clean clone: `docker compose up` (or `npm run dev`) + `.env` from `.env.example` + documented PayPal Sandbox credentials → full end-to-end flow works in ≤ 5 commands.
- **AC-8.2** A hosted live URL (Render) is deployed and warm with identical behavior through the entire judging period (**until 15 Dec 2026**).
- **AC-8.3** Root `README.md` features a dedicated **"Judge Quickstart & Test Scenarios"** section with 1-click presets for Happy Path Capture, Blocked Offer, and Pre-Capture Drift Rejection ([submission.md §5](submission.md#5-judge-access-goes-in-readme-and-devpost-testing-instructions)).

### US-9 Reconcile asynchronous PayPal webhooks (P2 — Stretch Goal)
- **AC-9.1** A signature-verified webhook endpoint for `PAYMENT.CAPTURE.COMPLETED` / `DENIED` / `CHECKOUT.PAYMENT-APPROVAL.REVERSED` reconciles matching purchases; unverifiable or duplicate events are logged and ignored.

## 6. Functional requirements

| ID | Requirement | Story | Pri |
|---|---|---|---|
| FR-01 | Accept request text 1–1,000 chars; strip/reject control characters except newline. | US-1 | P0 |
| FR-02 | Extract draft mandate via AI adapter returning strict JSON validated by a shared Zod schema. | US-1 | P0 |
| FR-03 | Produce `clarificationQuestions[]` for missing required fields; never guess or default quantity or budget. | US-1 | P0 |
| FR-04 | Allow manual edit, merchant preset chip selection, and explicit confirmation; confirmed mandate is immutable and versioned. | US-2 | P0 |
| FR-05 | Search products via server-side Channel3 adapter (timeout, bounded results, cache) with deterministic fixture fallback behind the same interface. | US-3 | P0 |
| FR-06 | Normalize offers: merchant domain (lowercase, strip `www.`), price → integer minor units (cents), currency, and recurrence signal. | US-3 | P0 |
| FR-07 | Evaluate each offer with a pure, versioned policy function; persist findings and `policyVersion`. | US-3 | P0 |
| FR-08 | Create purchase from (`mandate`, `offer`) with server-computed total; compute canonical SHA-256 `mandateHash` over (`mandateId`, `mandateVersion`, `offerId`, `merchantDomain`, `quantity`, `unitPriceMinor`, `totalMinor`, `currency`, `recurring`). | US-4 | P0 |
| FR-09 | Record explicit human approval with 15-min TTL; reject requests containing unexpected client-side price/decision fields (`400 UNEXPECTED_FIELD`). | US-4 | P0 |
| FR-10 | Mediate PayPal order creation via the **PayPal MCP Server** (`create_order`) / Orders v2 (`intent: CAPTURE`) only from an `APPROVED` purchase using a deterministic `PayPal-Request-Id`. | US-5 | P0 |
| FR-11 | Execute the **Pre-Capture Verification Gate** (AC-5.2: inspect live order via PayPal MCP `get_order` / Orders v2 `GET`, verify `mandateHash`, policy, and TTL) before invoking capture with a stable `PayPal-Request-Id`; support safe Judge Drift Simulation (`AC-5.6`). | US-5 | P0 |
| FR-12 | Enforce purchase state transitions server-side using optimistic concurrency / compare-and-set; reject illegal transitions with `409 CONFLICT`. | US-4/5 | P0 |
| FR-13 | Write append-only, SHA-256 hash-chained audit events (`prevHash`, `entryHash`) for every policy evaluation, MCP tool call, approval, drift block, and capture result. | US-6 | P0 |
| FR-14 | Provide audit list API with filtering, Intent Receipt detail API, chain verification API, and 1-click Demo Session Seeder API (`AC-6.5`). | US-6 | P0 |
| FR-15 | Provide session-scoped analytics dataset endpoint for AG Studio (`US-7`). | US-7 | P0 |
| FR-16 | Proxy AG Studio Governance Analyst agent turns through the server (`clientToolRunner`) with a strict read/widget-only tool allow-list and kill switch. | US-7 | P0 |
| FR-17 | Enforce anonymous session isolation via signed/HTTP-only session cookie or header so each reviewer's sandbox tests are isolated. | All | P0 |
| FR-18 | Expose `/api/health` endpoint reporting service and adapter readiness without leaking secrets. | US-8 | P0 |
| FR-19 | Export OpenAPI 3.1 spec and Postman collection covering happy-path and tamper/drift test cases. | US-8 | P1 |
| FR-20 | Webhook listener with PayPal signature verification and event-ID deduplication. | US-9 | P2 |

## 7. Non-functional requirements

| ID | Category | Requirement | How verified |
|---|---|---|---|
| NFR-1 | Correctness | Policy function and `mandateHash` canonicalizer are pure and deterministic: identical inputs + `policyVersion` ⇒ identical output. | Unit & determinism test suite |
| NFR-2 | Latency | Draft mandate p95 ≤ 10 s; offer search+evaluate p95 ≤ 5 s (fixture/warm cache ≤ 1 s); PayPal MCP/capture round-trip bounded by 15 s timeout. | Structured latency logs |
| NFR-3 | Money | Zero floating-point arithmetic on monetary values; all prices and totals stored and compared as integer minor units (`USD` cents). | Unit tests + schema checks |
| NFR-4 | Idempotency | Duplicate order creation or capture requests for the same `purchaseId` produce at most one side effect via `PayPal-Request-Id` and DB state locks. | Concurrent integration test |
| NFR-5 | Security | No secrets in client bundle, repo, or logs; strict Zod `.strict()` input schemas; OWASP security headers; rate limiting on AI and payment routes. See [security.md](security.md). | Automated schema & header tests |
| NFR-6 | Durability | Audit ledger and purchase state survive container restarts (persisted in managed DB). | Redeploy persistence check |
| NFR-7 | Accessibility | Full keyboard navigation across mandate, approval, and receipt drawers; semantic form labels; live status announcements (`aria-live`). | Manual + automated DOM check |
| NFR-8 | Observability | Structured JSON logs containing `requestId`, `purchaseId`, `mcpTool`, and `paypalDebugId` with automatic token redaction. | Log format assertion |
| NFR-9 | Transparency | Clear UI badges distinguishing `Live: Channel3` vs `Fixture Catalog`, `PayPal Sandbox`, and `Simulated Drift`. | UI component assertions |
| NFR-10 | Reproducibility | Clean clone to running local stack in ≤ 5 documented commands. | Dry-run verification |
| NFR-11 | Availability | Render deployment kept warm without cold-start timeouts through 15 Dec 2026. | Health check ping |

## 8. Success criteria (measured, not projected)

| Criterion | Evidence produced |
|---|---|
| Policy & hash determinism | 100% of policy, money-math, and `mandateHash` unit tests pass. |
| Guardrail integrity | All mandatory tamper, drift, TTL expiry, and replay scenarios in [test-plan.md §4](test-plan.md#4-mandatory-scenarios) fail closed (`400` / `409` / `BLOCKED_AT_CAPTURE`). |
| Payment & MCP truth | Every `COMPLETED` purchase has a matching PayPal Sandbox order verified via PayPal MCP / Orders v2 `GET` and an intact audit hash chain. |
| Judge reproducibility | Any reviewer can verify both a live PayPal Sandbox capture and a pre-capture drift block in under 3 minutes using the UI presets. |

No speculative market size, ROI savings, or unverified accuracy percentages are claimed.

## 9. Out of scope

See [README.md](README.md#scope-fence-do-not-build). Any scope addition requires an explicit update to this specification.