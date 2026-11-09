# IntentLock

> AI proposes. Code enforces. You approve.

A buyer-side deterministic policy gate between AI shopping agents, the **PayPal MCP Server** and **PayPal Orders v2 (Sandbox)**. Specification: [spec/README.md](spec/README.md).

**Status:** Stage 4 implementation and local verification. Hosted E2E and live-provider behavior remain unverified. Sandbox only: no real money.

## Quick start

Requires Node 22+ and a hosted Postgres `DATABASE_URL` (no Docker needed).

```bash
npm ci
cp .env.example .env        # fill every <REPLACE_ME>; never commit .env
npm run build
npm run db:migrate          # applies apps/api/migrations
npm run dev                 # API on :3000 (tsx watch)
npm run dev:web             # Vite on :5173, proxies /api
```

Production: `node apps/api/dist/server.js` serves the API and the built SPA (see [render.yaml](render.yaml)).

## Checks

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Tests need no secrets: Postgres is PGlite in-process and PayPal is a local double.

## Mandate and purchase flow (Stage 2)

In fixture mode, create a mandate with `POST /api/mandates`, confirm it with
`POST /api/mandates/:id/confirm`, then search with `POST /api/mandates/:id/search`.
Create a purchase only from an `ALLOWED` result using `POST /api/purchases`; the API
re-evaluates the offer and computes its total and mandate hash on the server. Approve
with `POST /api/purchases/:id/approve` by echoing that hash, or cancel with
`POST /api/purchases/:id/cancel`. See [e2e/api-flow.http](e2e/api-flow.http).

## Payment integrity (Stage 3)

After the mandate flow above, explicitly approve the purchase hash, create a PayPal
order, approve it in the Sandbox popup, then capture. The temporary auto-approved
`/api/dev/purchases` route has been removed. The small web smoke-test screen now
confirms a sample mandate and requires a separate purchase approval before PayPal.

Before capture the server checks the live order ID/status, amount/currency,
`custom_id`, protected mandate hash/merchant, current policy and approval expiry.
Failures become `BLOCKED_AT_CAPTURE` with structured findings; PayPal is not captured.
MCP read failures fall back to REST. If both reads fail, the API returns `504` and
leaves the purchase retryable in `ORDER_CREATED`.

The pinned MCP tool accepts only `currencyCode`, `items`, discount/shipping fields,
notes and return/cancel URLs. It cannot accept purchase bindings or a request ID.
After MCP creation, the server persists the returned order ID, then uses verified
[Orders v2 PATCH](https://developer.paypal.com/docs/api/orders/v2/#orders_patch)
support to set `custom_id` and `invoice_id`, and verifies them **before** exposing
the order ID to the browser. No order is patched after buyer approval. A known
order's failed binding can be retried without another create call. An unknown
MCP create outcome is not automatically replayed; it requires manual reconciliation.
The REST create fallback supplies the bindings and stable request ID at creation.

Capture uses a stable stored `PayPal-Request-Id`. A timeout stays `CAPTURING`,
not falsely failed. Reading a purchase after 60 seconds reconciles its live
capture evidence; an approved, uncaptured order can then be retried with the same
request ID and all gates rerun. `CAPTURE_PENDING` is also reconciled on read.

## Audit and demo controls

- `GET /api/audit?limit=50&cursor=...&decision=BLOCKED&state=BLOCKED_AT_CAPTURE&seeded=false`
  returns a session-scoped, cursor-paginated offer/purchase ledger. Filters are optional.
- `GET /api/purchases/:id/receipt` and `GET /api/offers/:id/receipt` return the
  mandate, findings, approval, MCP trace summaries and relevant audit events.
- `GET /api/audit/verify` recomputes the whole session chain, returning `INTACT`
  and `checked`, or `BROKEN` with a string `firstBrokenSeq` and zero-based
  `firstBrokenIndex`. Event sequence numbers cross the wire as strings.
- With `DEMO_CONTROLS_ENABLED=true`, `POST /api/purchases/:id/simulate-drift`
  accepts `{"kind":"PRICE_HIKE"}`, `MERCHANT_SWAP` or `APPROVAL_EXPIRED`, only in
  `ORDER_CREATED`. It changes only the override, not approved mandate/snapshot
  fields, and can only add gate failures.
- `POST /api/demo/seed {}` inserts one sample mandate, four evaluated offers and
  two purchases (sample capture and drift block). Every sample is labelled,
  events use the normal chain, and no PayPal/MCP calls occur. Repeating it in the
  same session returns the original counts without inserting anything.
- Both demo routes return `404` when disabled. Sample purchases cannot call PayPal.

Audit appends share the state-changing transaction and lock the session row first.
Database triggers prohibit updates, deletes and truncation of audit events.
Strict-schema rejections are audited using unexpected field names, never values.
Run migrations before starting this version. Existing pre-audit history is not
backfilled or presented as verified event evidence.
Pre-audit purchases must be recreated through the mandate and human-approval
flow to obtain the evidence required by the full capture gate.

The automated drift-to-`INTACT`, stub-MCP happy path and ten-way concurrent capture
checks run in `npm test`. Coverage:
`npm run test -w apps/api -- --coverage` (95% minimum core lines and branches).
These local checks are not a claim that hosted Render or live PayPal Sandbox
checkout has been verified.

## Procurement and governance UI (Stage 4)

The web app provides a five-step request, mandate, offer, approval and checkout
flow; a session-scoped AG Grid Community audit ledger with receipt and chain
verification; and an AG Studio governance dashboard with the Mandate Integrity
& MCP Gate widget. Demo controls are labelled and only available when enabled.
The Governance Analyst is optional, requires `STUDIO_AGENT_ENABLED=true` and
Gemini configuration, and can call dashboard tools only; it has no payment or
PayPal MCP tools. Its API contracts are `GET /api/analytics/dataset` and
`POST /api/studio-agent/turn`; the latter returns AG-UI-compatible SSE events.

Local typecheck, lint, build and automated tests do not verify hosted E2E-01..17,
live Gemini behavior, PayPal Sandbox checkout, or an AG Studio license key.

## License

MIT
