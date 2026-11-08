# IntentLock — Specification Pack

> **AI proposes. Code enforces. You approve.**
> A buyer-side deterministic policy gate sitting between AI shopping agents, the **PayPal MCP Server**, and the **PayPal Orders v2 Sandbox**. IntentLock binds a user-confirmed purchase mandate to one exact PayPal order and refuses capture if any protected field (amount, currency, merchant, item SKU, or shipping terms) drifts between approval and execution.

| Field | Value |
|---|---|
| Status | Baseline v1.1 — approved for 6-day build sprint |
| Spec date | 29 Oct 2026 |
| Build sprint window | **6-Day Sprint Target: 04 Nov 2026** (Official Portal Deadline: 12 Nov 2026, 12:00 PT / 13 Nov 2026, 01:30 IST) |
| Core PayPal Stack | **PayPal MCP Server** (tool discovery, order creation & pre-capture state inspection) + **PayPal Orders v2 Sandbox API** |
| Sponsor Integrations | **AG Grid / AG Studio** (governance & audit table UI), **Channel3** (catalog discovery/quotes only), **Render** (cloud hosting), **Postman** (API contract & regression suite) |
| Local Reference Artifacts | `../paypal-ai-hackathon-blueprint.md`, `../intentlock-prototype.html`, `../IntentLock-Intent-Gate-Pitch.html` *(local design docs)* |

## Reading order

| # | File | Answers | Primary reader |
|---|---|---|---|
| 1 | [spec.md](spec.md) | *What* are we building and how do we know it works? (user stories, FR/NFR IDs, acceptance) | Everyone |
| 2 | [research.md](research.md) | What did we verify in official docs (PayPal Orders v2, PayPal MCP Server, sponsor tools), and which decisions follow? | Tech lead, reviewers |
| 3 | [architecture.md](architecture.md) | *How* is it built? (containers, MCP mediation flow, components, state machine, ADRs) | Engineers |
| 4 | [data-model.md](data-model.md) | Tables, invariants, money rules, lightweight SHA-256 audit hash chain | Backend |
| 5 | [contracts/api.md](contracts/api.md) | Every HTTP route, MCP tool wrapper shape, request/response schema, error codes, policy reason codes | Frontend + backend |
| 6 | [security.md](security.md) | Threat model (STRIDE), prompt-injection & cart-drift controls, secrets, headers | Everyone touching payments |
| 7 | [test-plan.md](test-plan.md) | Test pyramid, mandatory drift/tamper scenarios, evidence for judges | QA / everyone |
| 8 | [plan.md](plan.md) | 6-day sprint calendar, phases, quality gates, risk burndown | Team lead |
| 9 | [tasks.md](tasks.md) | Ordered, dependency-tagged task list for Copilot / devs | Engineers |
| 10 | [submission.md](submission.md) | Rules compliance matrix, sponsor prize alignment, Devpost copy, judge access, demo video script | Team lead / submitter |

## Five rules that override everything else

1. **The LLM never authorizes money directly.** The AI agent produces a *draft* mandate only. Every **PayPal MCP Server** tool call or Orders v2 request is mediated by IntentLock's deterministic policy engine; a human approves the locked mandate; PayPal captures only after cryptographic mandate verification.
2. **The server owns every number.** Totals are recomputed deterministically from stored server snapshots in integer minor units (e.g., cents). Client-sent or LLM-hallucinated amounts are rejected with an explicit policy violation, never ignored silently.
3. **Unknown fails closed.** Missing price, unverified merchant ID, ambiguous SKU, or mismatched currency → `NEEDS_REVIEW` (non-purchasable) — never `ALLOWED`.
4. **One approval binds one exact PayPal order.** User approval computes an immutable `mandateHash` over protected fields (`merchantId`, `currency`, `totalMinor`, `lineItemsHash`, `shippingAddressHash`). Right before capture, IntentLock re-queries the live PayPal Sandbox order state (via PayPal MCP / Orders v2 `GET`); any post-approval drift, tampering, or TTL expiration immediately aborts capture (`DRIFT_DETECTED`).
5. **Every decision is verifiable evidence.** Policy blocks, MCP tool invocations, human approvals, drift rejections, and PayPal Sandbox responses are written to an append-only, SHA-256 hash-chained audit log (`prevHash` + `entryHash`).

## Scope fence (do not build)

Real-money payments (Sandbox only) · live retailer checkout execution via Channel3 (read/quote catalog only) · unmediated/autonomous LLM payment capture · multi-agent payment swarms · vector databases · Bryntum · Render Workflows · AG Grid Enterprise server-side row models (AG Studio trial is scoped strictly to the governance & audit dashboard) · complex multi-user RBAC beyond session-scoped buyer mandates.