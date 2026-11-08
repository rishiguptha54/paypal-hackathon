# IntentLock — API Contract

> Source of truth for HTTP behavior. `docs/openapi.yaml` is **generated** from the shared Zod schemas and must match this file; CI fails on drift. Data shapes: [../data-model.md](../data-model.md). Flows: [../architecture.md §6](../architecture.md#6-key-runtime-flows).

## 1. Conventions

- Base path `/api`. JSON only: requests without `Content-Type: application/json` on non-GET routes ⇒ `415` (also blocks simple-form CSRF).
- Session: `il_sid` cookie — `HttpOnly; Secure; SameSite=Lax; Path=/`, signed. Created on first request. Every resource is scoped to it; foreign IDs ⇒ `404`.
- All request bodies are **strict** Zod objects: unknown keys ⇒ `400 UNEXPECTED_FIELD` (+ audit `REQUEST_REJECTED`).
- Money in responses: `{ "minor": "29800", "currency": "USD", "display": "$298.00" }`. `minor` is a string to avoid JS number precision issues.
- IDs are UUIDs; path params validated before any DB access.
- Every response carries `X-Request-Id`.

### Error envelope

```json
{ "error": { "code": "STATE_CONFLICT", "message": "Purchase is not awaiting approval.", "requestId": "0b6…", "details": [] } }
```

| HTTP | Codes |
|---|---|
| 400 | `VALIDATION_FAILED`, `UNEXPECTED_FIELD` |
| 401 | `SESSION_REQUIRED` |
| 404 | `NOT_FOUND` (also returned for demo routes when `DEMO_CONTROLS_ENABLED=false`) |
| 409 | `STATE_CONFLICT`, `POLICY_BLOCKED`, `CAPTURE_BLOCKED`, `MANDATE_HASH_MISMATCH`, `APPROVAL_EXPIRED` |
| 413 | `PAYLOAD_TOO_LARGE` (limit 16 KB) |
| 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 422 | `NEEDS_CLARIFICATION` |
| 429 | `RATE_LIMITED` (+ `Retry-After`) |
| 502 / 504 | `UPSTREAM_ERROR` / `UPSTREAM_TIMEOUT` (`details[0].provider` = `ai`, `channel3`, `paypal_mcp`, `paypal`) |

## 2. Rate limits (per session, sliding 1 min; plus 300/min per IP global)

| Route group | Limit | Reason |
|---|---|---|
| `POST /mandates` | 10 | LLM cost |
| `POST /mandates/:id/search` | 20 | Channel3 quota |
| Payment routes (incl. `simulate-drift`) | 20 | Abuse / accidental loops |
| `POST /demo/seed` | 3 | Idempotent anyway; stops loops |
| `POST /studio-agent/turn` | 15 (max 8 turns per run) | LLM cost |
| Reads | 120 | |

## 3. Routes

| # | Method & path | Body | Success | Notes |
|---|---|---|---|---|
| 1 | `GET /health` | — | `200 {status, checks:{db, paypal, paypalMcp, catalog, ai}}` | Values are `ok` / `degraded` / `down` only; no URLs, keys or error text (FR-18) |
| 2 | `GET /config` | — | `200 {paypalClientId, productSource, aiProvider, environment:"sandbox", merchantPresets: string[], scenarioPresets: ScenarioPreset[], demoControlsEnabled}` | Public values only. `merchantPresets` come from the active catalog source (AC-2.1) |
| 3 | `POST /mandates` | `{requestText}` | `201 Mandate` | Status `DRAFT` or `NEEDS_CLARIFICATION` |
| 4 | `GET /mandates/:id` | — | `200 Mandate` | |
| 5 | `POST /mandates/:id/confirm` | `MandateFields` | `200 Mandate` (CONFIRMED) | If called on a CONFIRMED mandate with different fields ⇒ new version, old ⇒ SUPERSEDED |
| 6 | `POST /mandates/:id/search` | `{}` | `200 {source, offers: EvaluatedOffer[]}` | Requires CONFIRMED |
| 7 | `POST /purchases` | `{mandateId, offerSnapshotId}` | `201 Purchase` (PENDING_APPROVAL) | Re-evaluates; `409 POLICY_BLOCKED` if not ALLOWED |
| 8 | `GET /purchases/:id` | — | `200 Purchase` | Reconciles `CAPTURING` > 60 s via PayPal MCP `get_order` (REST fallback) |
| 9 | `POST /purchases/:id/approve` | `{mandateHash}` | `200 Purchase` (APPROVED) | Hash must equal server value (proves user saw this exact order) |
| 10 | `POST /purchases/:id/paypal/create-order` | `{}` | `200 {paypalOrderId}` | Calls PayPal MCP `create_order` with server-stored values. Idempotent: returns existing order if already created. Used by JS SDK v6 `createOrder` and react-paypal-js `createOrder` |
| 11 | `POST /purchases/:id/paypal/capture` | `{paypalOrderId}` | `200 Purchase` (CAPTURED / CAPTURE_PENDING) | Runs the pre-capture verification gate; `409 CAPTURE_BLOCKED` with `details` = failed checks. Used by `onApprove` |
| 12 | `POST /purchases/:id/cancel` | `{}` | `200 Purchase` (CANCELLED) | Allowed from PENDING_APPROVAL, APPROVED, ORDER_CREATED |
| 13 | `GET /audit` | query: `limit≤100`, `cursor`, `decision?`, `state?`, `seeded?` | `200 {rows: LedgerRow[], nextCursor}` | Feeds AG Grid |
| 14 | `GET /purchases/:id/receipt` | — | `200 IntentReceipt` | |
| 15 | `GET /offers/:snapshotId/receipt` | — | `200 IntentReceipt` (no `purchase`) | Receipts for blocked / review offers |
| 16 | `GET /audit/verify` | — | `200 {status:"INTACT"\|"BROKEN", checked, firstBrokenSeq?, firstBrokenIndex?}` | Recomputes the whole session chain (AC-6.4) |
| 17 | `POST /webhooks/paypal` | raw PayPal event | `200` always after storage | **P2 (US-9).** No session; signature verified; separate rate limit |
| 18 | `GET /analytics/dataset` | query: `days≤90` | `200 {rows: AnalyticsRow[]}` (≤ 5 000 rows) | Read-only; feeds AG Studio |
| 19 | `POST /studio-agent/turn` | `{threadId, messages[], tools[]}` (tools = Studio tool schemas, allow-listed by name) | `200 text/event-stream` of AG-UI events | Read-only; `404` when `STUDIO_AGENT_ENABLED=false` |
| 20 | `POST /paypal/client-token` | `{}` | `200 {clientToken, expiresIn}` | Only for the JS SDK v6 path if it needs a client token (research D2); domain-bound, 15 min |
| 21 | `POST /purchases/:id/simulate-drift` | `{kind: "PRICE_HIKE"\|"MERCHANT_SWAP"\|"APPROVAL_EXPIRED"}` | `200 Purchase` (with `simulatedDrift`) | AC-5.6. Only in `ORDER_CREATED`, else `409 STATE_CONFLICT`. Next capture is blocked by the gate. [architecture.md §6.5](../architecture.md#65-judge-demo-controls-ac-56-ac-65) |
| 22 | `POST /demo/seed` | `{}` | `201 {seeded: {mandates, evaluations, purchases}}` or `200` if already seeded | AC-6.5. Session-scoped; no PayPal/MCP calls |

## 4. Schemas (shared Zod → TS)

```ts
MandateFields = strict({
  productQuery: string().trim().min(2).max(200),
  quantity: int().min(1).max(100),
  maxTotal: string().regex(/^\d{1,9}(\.\d{1,2})?$/),   // decimal string, converted to minor units server-side
  currency: literal("USD"),
  allowedMerchantDomains: array(domain()).min(1).max(20),
  recurringAllowed: boolean(),
  excludedTerms: array(string().trim().min(2).max(40)).max(20).default([]),
})

Mandate = MandateFields.partial() & {
  id, version, status: "DRAFT"|"NEEDS_CLARIFICATION"|"CONFIRMED"|"SUPERSEDED",
  requestText, clarificationQuestions: {field, question}[], parser, createdAt, confirmedAt?
}

EvaluatedOffer = {
  snapshotId, source: "channel3"|"fixture", title, brand?, merchantName?, merchantDomain?,
  offerUrl?, unitPrice?: Money, totalPrice?: Money, recurrenceSignal: "NONE"|"RECURRING"|"AMBIGUOUS",
  decision: "ALLOWED"|"BLOCKED"|"NEEDS_REVIEW", findings: Finding[], policyVersion, observedAt, seeded: boolean
}

Purchase = {
  id, mandateId, offerSnapshotId, state, quantity, unitPrice: Money, total: Money,
  mandateHash, approvedAt?, approvalExpiresAt?, paypalOrderId?, paypalCaptureId?,
  paypalStatus?, blockReasons?: Finding[], simulatedDrift?: "PRICE_HIKE"|"MERCHANT_SWAP"|"APPROVAL_EXPIRED",
  seeded: boolean, createdAt, updatedAt
}

LedgerRow = {
  id, time, kind: "OFFER"|"PURCHASE", product, merchant, source, decision, reasonCodes: string[],
  approvalHashStatus: "NONE"|"LOCKED"|"VERIFIED"|"MISMATCH", paypalOrderId?,
  mcpTraceStatus: "NONE"|"OK"|"FALLBACK_REST"|"ERROR", state?, total?: Money, seeded: boolean
}

IntentReceipt = {
  requestText, mandate, offer: EvaluatedOffer, purchase?, approval?: {mandateHash, approvedAt, expiresAt},
  mcpTrace: {tool: "create_order"|"get_order", status, durationMs, at, fallbackToRest: boolean}[],
  paypal?: {orderId, captureId?, status, debugId?},
  events: {seq, type, createdAt, entryHash}[], chain: "INTACT"|"BROKEN", sandboxNotice: string, seeded: boolean
}

AnalyticsRow = {
  time, day, productQuery, merchantDomain?, source, decision, primaryReason, reasonCodes: string[],
  offerTotalMinor?: string, approved: boolean, purchaseState?, capturedTotalMinor?: string,
  blockedAtCapture: boolean, captureBlockCodes: string[], mcpTraceStatus,
  approvalToCaptureSeconds?: number, policyVersion, seeded: boolean
}

ScenarioPreset = { id: "HAPPY_PATH"|"BLOCKED_OFFER"|"PRECAPTURE_DRIFT", label, requestText }   // AC-8.3
```

`domain()` = lowercase, IDNA-normalized, `^[a-z0-9-]+(\.[a-z0-9-]+)+$`, ≤ 253 chars; leading `www.` stripped.

## 5. Policy reason codes

`packages/shared/src/reasonCodes.ts` is the single registry. Adding a code requires a test and a template message.

### 5.1 Offer evaluation

| Code | Severity | Fires when | Template |
|---|---|---|---|
| `ALL_RULES_PASSED` | INFO | No other finding | "All mandate rules passed." |
| `OVER_BUDGET` | BLOCKING | `unit × qty > maxTotal` | "Total {total} exceeds the {max} limit." |
| `VENDOR_NOT_APPROVED` | BLOCKING | domain not equal to, or subdomain of, an allowed domain | "{domain} is not an approved merchant." |
| `RECURRING_NOT_ALLOWED` | BLOCKING | `recurrenceSignal = RECURRING` and `!recurringAllowed` | "Offer includes recurring terms ('{evidence}') you did not authorize." |
| `CURRENCY_UNSUPPORTED` | BLOCKING | currency ≠ mandate currency | "Offer is priced in {currency}; mandate allows {mandateCurrency}." |
| `EXCLUDED_TERM_PRESENT` | BLOCKING | title/brand contains an excluded term (case-insensitive, word boundary) | "Offer matches excluded term '{term}'." |
| `PRICE_UNKNOWN` | REVIEW | price missing or unparseable | "Price could not be verified." |
| `CURRENCY_UNKNOWN` | REVIEW | currency missing | "Currency could not be verified." |
| `MERCHANT_UNKNOWN` | REVIEW | merchant domain missing | "Merchant could not be verified." |
| `RECURRENCE_UNCLEAR` | REVIEW | `recurrenceSignal = AMBIGUOUS` and `!recurringAllowed` | "Offer may include recurring terms ('{evidence}'); review before buying." |

### 5.2 Pre-capture verification gate (purchase → `BLOCKED_AT_CAPTURE`)

| Code | Check |
|---|---|
| `ORDER_MISMATCH` | G1: request `paypalOrderId` ≠ stored `paypal_order_id` |
| `PAYPAL_NOT_APPROVED` | G2: live PayPal order status ≠ `APPROVED` |
| `DRIFT_AMOUNT_MISMATCH` | G3: live PayPal amount/currency ≠ stored total, or simulated `PRICE_HIKE` |
| `CUSTOM_ID_MISMATCH` | G4: live PayPal `custom_id` ≠ purchase ID |
| `DRIFT_MERCHANT_MISMATCH` | G5: current snapshot merchant domain ≠ approved merchant domain, or simulated `MERCHANT_SWAP` (reported together with `MANDATE_CHANGED`) |
| `MANDATE_CHANGED` | G5: recomputed `mandateHash` ≠ approved hash |
| `POLICY_NOW_BLOCKS` | G6: re-evaluation not `ALLOWED` (e.g. policy version or data changed) |
| `APPROVAL_EXPIRED` | G7: `now ≥ approval_expires_at`, or simulated `APPROVAL_EXPIRED` |

If neither MCP `get_order` nor REST `GET` returns a valid order, the gate returns `504 UPSTREAM_TIMEOUT` / `502 UPSTREAM_ERROR`, does not capture, and leaves the purchase in `ORDER_CREATED`.

## 6. PayPal outbound calls (server only)

**Create order** — PayPal MCP Server tool `create_order` via `PayPalMcpGateway` (research D1). Arguments are built only from the stored purchase and map to this Orders v2 body; confirm the tool's exact argument names against the pinned MCP Server version in Phase 1. If the MCP Server is unavailable, the gateway falls back to REST `POST /v2/checkout/orders` with `PayPal-Request-Id: <stored uuid>` and the same body; `invoice_id` makes PayPal reject a second order for the same purchase.

```json
{
  "intent": "CAPTURE",
  "purchase_units": [{
    "reference_id": "<purchaseId>",
    "custom_id": "<purchaseId>",
    "invoice_id": "<purchaseId>",
    "description": "IntentLock sandbox test order",
    "amount": { "currency_code": "USD", "value": "298.00",
      "breakdown": { "item_total": { "currency_code": "USD", "value": "298.00" } } },
    "items": [{ "name": "<title, truncated 127>", "quantity": "2", "category": "PHYSICAL_GOODS",
      "unit_amount": { "currency_code": "USD", "value": "149.00" } }]
  }]
}
```

**Get order** — PayPal MCP tool `get_order`; fallback REST `GET /v2/checkout/orders/{id}` (pre-capture gate, reconcile-on-read).
**Capture** — REST `POST /v2/checkout/orders/{id}/capture`, `PayPal-Request-Id: <stored uuid>`, empty body. Never `PATCH` an order after approval.

Map from capture response: `purchase_units[0].payments.captures[0].{id,status}`; record header `paypal-debug-id`. Every MCP call is logged as a `PAYPAL_MCP_CALL` audit event (tool, status, duration; no payer data).
