# IntentLock — Hackathon Submission & Compliance

> Everything needed to **qualify, submit and stay judge-ready** for the PayPal AI Hackathon. Rules checked 26 Oct 2026 against the [official rules](https://paypalaihackathon.devpost.com/rules), [overview](https://paypalaihackathon.devpost.com/), [resources](https://paypalaihackathon.devpost.com/resources) and sponsor pages. Re-check the rules page on 9 Nov; the rules say they can change.

## 1. Key dates

| Event | Pacific Time | India (IST) | Our action |
|---|---|---|---|
| 6-day sprint exit | Wed 4 Nov 2026 | Wed 4 Nov 2026 | All P0 stories live on the hosted URL ([plan.md](plan.md#4-quality-gates-go--no-go) G3) |
| Submission deadline | Thu 12 Nov 2026, 12:00 | Fri 13 Nov 2026, 01:30 | Submit by **Wed 11 Nov, 18:00 IST** |
| Judging period | 1 Dec 14:00 – 15 Dec 08:00 | 2 Dec 03:30 – 15 Dec 21:30 | Hosted demo, sandbox accounts and keys **must work the whole time** |
| Winners announced | ~21 Dec 2026 | ~22 Dec 2026 | Rotate all keys after this |

## 2. Compliance matrix (all must be ✅ before submitting)

| # | Requirement (rules) | How IntentLock satisfies it | Evidence | Owner |
|---|---|---|---|---|
| C1 | Uses the PayPal developer platform in **Sandbox**, and PayPal is **central** | **PayPal MCP Server** `create_order` / `get_order` mediated by IntentLock's deterministic gate → buyer approval (JS SDK v6 or react-paypal-js) → pre-capture verification → Orders v2 capture | Video 1:20–2:20; `adapters/paypalMcp`, `adapters/paypal` | A |
| C2 | Uses an AI tool/model **meaningfully** | (1) LLM drafts the purchase mandate from plain English; (2) AG Studio agent builds governance dashboards on request | Video 0:15–0:35, 2:20–2:45 | B |
| C3 | Working project, runs as shown in the video | Hosted URL (pending deployment) and `npm run dev` with a hosted Postgres URL; no Docker required | Local checks in [TESTING.md](../TESTING.md); hosted verification pending | D |
| C4 | Text description of features | Devpost story (§4) | Devpost | Lead |
| C5 | **"Tools" field**: name each AI model/service and how it is used | §4.3 table | Devpost | Lead |
| C6 | Public repo on GitHub with all source, assets, instructions | `README.md` + `spec/` | Repo | D |
| C7 | OSI license **visible in the repo About section** | `LICENSE` (MIT), GitHub detects it | Repo sidebar screenshot | D |
| C8 | Video < 3 min, public on YouTube, shows the app working | [plan.md §7](plan.md#7-demo-video-script-under-3-minutes) | YouTube link | All |
| C9 | No third-party trademarks or copyrighted music in the video without permission | No music (or a CC0/royalty-free track with license saved); fixtures use **fictional `.example` merchants**; no retailer logos or product images on screen | Frame review checklist §6 | D |
| C10 | Judges get access: test credentials, keys or sandbox logins | §5 Judge Quickstart | README "Judge Quickstart & Test Scenarios" | A |
| C11 | Free, unrestricted access for testing until judging ends (15 Dec) | Planned Render free web service with 10-minute health pings; live availability and database retention must be verified and disclosed | §7 runbook | D |
| C12 | Third-party APIs/SDKs used under their terms | §8 license register | `THIRD_PARTY_NOTICES.md` | D |
| C13 | Original work owned by the entrants | Built during the submission period; commit history shows it | Git history (no history squash) | All |
| C14 | All materials in English | — | — | Lead |
| C15 | Team: one Representative submits; every member registered on Devpost and added to the project | Representative = team lead | Devpost team page | Lead |
| C16 | Eligibility: age of majority; not a resident of an excluded country; no sponsor/Devpost affiliation | Each member self-checks | — | Each |

### Employer / IP check (do this first — before Day 0, 29 Oct)

The rules require the submission to be **solely owned by the entrants** and not to infringe anyone else's rights. If any member is employed, check the employer's policy on outside projects, hackathons and IP before building.
- Build on **personal** devices and accounts (personal GitHub, personal PayPal developer, personal AI/Channel3/Render accounts).
- Keep project files out of corporate storage (e.g., company OneDrive) and corporate repos.
- Don't use employer confidential information, code or paid tool licenses unless the employer allows it.
- This is a checklist, not legal advice; ask your employer's policy owner if unsure.

## 3. Prize strategy

Allowed: at most **one Grand Prize or one Honorable Mention**, plus **one Sponsor Prize**.

| Track | Fit | What wins it (from the official criteria / sponsor pages) | Our proof point |
|---|---|---|---|
| Grand Prize (1st–3rd) | Primary | Strong across all five criteria; tie-break order is Tech Implementation → Design → Impact → Innovation → Presentation | Real PayPal MCP + Orders v2 flow with a pre-capture verification gate; complete UX |
| Best Use of Agentic Commerce | Strong | "Agents that … actually transact" (resources page) | The agent finds, evaluates and pays — but PayPal MCP tools only run inside a mandate the user locked |
| Best Use of PayPal + AI | Strong | Deep use of PayPal **and** AI | LLM mandate + deterministic PayPal MCP mediation + verified capture + AI governance dashboard |
| **Sponsor: Best Use of AG Grid** (primary sponsor) | Needs AG Studio (P0) | Sponsor page asks for **AG Studio** polish: **custom widgets, theming, layout tools** — "not just AG Grid or AG Charts on their own" — and the **Studio Agent Framework** | "Spend Governance Studio": themed AG Studio dashboard, custom *Mandate Integrity & MCP Gate* widget, custom agent via `clientToolRunner`, sample history for instant data (see [architecture.md §17](architecture.md#17-governance-studio-ag-studio)) |
| Sponsor: Best Use of Channel3 (fallback sponsor) | Already core | API or MCP used as a **meaningful** part of the product; calling it is required | Live search feeding the policy engine |

**Decision:** AG Grid (AG Studio) is the main sponsor target. If the AG Studio work misses sprint exit (G3, 4 Nov), switch the sponsor pitch to **Channel3** — no code change needed. Render and Postman are used for delivery quality, not for prizes.

## 4. Devpost submission content

### 4.1 Fields

| Field | Content |
|---|---|
| Project name | IntentLock |
| Tagline (≤ 200 chars) | "AI proposes. Code enforces. You approve. A buyer-side gate in front of the PayPal MCP Server that refuses capture if the order drifts from your locked mandate." |
| Built with (tags) | `paypal`, `paypal-mcp-server`, `model-context-protocol`, `paypal-orders-api`, `paypal-js-sdk`, `typescript`, `react`, `node.js`, `express`, `postgresql`, `zod`, `google-gemini`, `channel3`, `ag-grid`, `ag-studio`, `render`, `postman`, `playwright` |
| Try it out links | Hosted URL (add after verified deployment) · GitHub repo · [Postman collection](../postman/IntentLock.postman_collection.json) |
| Video | YouTube (public) |
| Image gallery (5–7 images, 3:2) | 1 hero (flow diagram with MCP gate) · 2 mandate editor with merchant chips · 3 offers with block reasons · 4 PayPal sandbox approval · 5 pre-capture drift block (`DRIFT_AMOUNT_MISMATCH`) · 6 Governance Studio dashboard · 7 Intent Receipt with MCP trace and chain INTACT |

### 4.2 Devpost story (copy-ready draft)

**Publication gate:** This describes implemented behavior, not a completed hosted demo. Complete live smoke, add verified hosted/video links and identify the actual model used before publishing. Mocked test evidence is not a live-payment claim.

#### Inspiration

An AI recommendation is not a purchase authorization. A small-business buyer may delegate finding a chair while still needing control over budget, approved merchants and subscriptions. IntentLock separates those responsibilities: AI proposes, code enforces and the buyer approves.

#### What it does

A request becomes a draft mandate that the buyer reviews and confirms. Product candidates receive deterministic ALLOWED, BLOCKED or NEEDS_REVIEW decisions with reason codes. The buyer approves one exact server-calculated purchase before opening PayPal Sandbox. Before capture, the backend verifies the live PayPal order against the locked mandate; drift blocks capture and produces an auditable receipt. The ledger and Governance Studio explain the session's decisions, with synthetic history clearly labelled.

#### How we built it

React 19 and TypeScript provide the request-to-checkout flow, AG Grid Community ledger and AG Studio dashboard. The Express backend validates external inputs with Zod, stores money as bigint minor units and persists state and a hash-chained audit in Postgres. The Google GenAI adapter drafts intent with structured JSON output; the rule parser and fixture catalog make offline tests possible. Channel3 is an optional live backend catalog source. The server mediates PayPal MCP `create_order` and `get_order`; REST binds and verifies the order and performs capture with a stable request ID. The model has no authority to approve or capture.

#### Challenges we addressed

The pinned MCP create tool cannot carry all IntentLock purchase bindings, so the server binds and verifies its created order before exposing it to the browser. Unknown create outcomes are not blindly retried. Capture uses compare-and-set state transitions, a persisted request ID and reconciliation instead of interpreting timeouts as success. The demo drift control adds failures to the capture gate and cannot authorize a payment.

#### Accomplishments

The implemented flow includes strict tamper rejection, server-side capture verification, receipts with MCP traces, a filterable Community ledger and a dashboard-only Governance Analyst. The release suite exercises the requested judge scenarios with local PayPal mocks and a stub MCP server, including keyboard checkout and an axe scan. See [TESTING.md](../TESTING.md) for observed counts and command results; no hosted verification or CI result is implied. No adoption, savings, performance or live-transaction metrics are claimed.

#### What the implementation demonstrates

Payment authorization needs deterministic checks on both sides of buyer approval, not just a plausible model response. Provider responses must be validated and unknown payment outcomes must remain unknown until reconciled. Sample analytics are useful only when they cannot be mistaken for real captured payments.

#### What's next

Hosted Sandbox smoke, license confirmation, a public recording and clean-clone verification are release gates, not completed milestones. Future work could add team approval chains and multi-currency after strengthening live-provider coverage. Production payments and merchant fulfilment are outside this Sandbox project's scope.

### 4.3 "Tools" field (required)

| Tool | Type | How it is used |
|---|---|---|
| Google Gemini via `@google/genai` | AI model | Structured JSON mandate draft, strict Zod validation and deterministic fallback. Configured model target: `AI_MODEL=gemini-3.8-flash`; verify access and record the actual deployed model before submission. The parser sees only the request and cannot approve or pay. |
| Google Gemini + AG Studio Agent Framework | AI agent | Governance Analyst edits dashboard widgets from session-scoped audit analytics. Payment-read-only: dashboard edits are allowed, payment tools are absent. Optional, live verification pending. |
| PayPal MCP Server (Sandbox) | Payments tools (MCP) | Server-only `create_order` and `get_order`, allow-listed; short-lived access token, no client secret in the child environment. Create/capture require policy and human approval; reconciliation may read an existing order. Purchase-operation traces are audited. |
| PayPal Orders v2 + JS SDK (Sandbox) | Payments | Buyer approval, server-side capture with idempotency key, fallback order read |
| Channel3 Search API | Product data | Live product offers for the policy engine |
| AG Grid / AG Studio | UI | Audit ledger and governance dashboard |
| Render | Hosting | Web service + Postgres |
| Postman | API tooling | Happy-path, unexpected-total tamper and drift collection with response assertions |
| GitHub Copilot | Dev tool | Coding assistant (named for transparency) |

## 5. Judge access (goes in README and Devpost "testing instructions")

README section title: **"Judge Quickstart & Test Scenarios"** (AC-8.3). The hosted URL and dedicated judge sandbox buyer credentials are intentionally blank until deployment and private account setup are complete; do not publish account secrets in the repository.

- **Hosted demo:** pending verified deployment. Sessions are anonymous and isolated; add the URL only after live smoke passes.
- **PayPal sandbox buyer:** email + password of a **dedicated sandbox personal account** made only for judges. Never share the sandbox **business** account or the REST app secret.
- **Optional card path:** PayPal sandbox card generator link, for judges who can't log in.
- **1-click scenario presets (AC-8.3):** **Allowed purchase**, **Over-budget offer**, **Pre-capture drift** — actual UI labels, with the expected-results table in the root README.
- **Cold start:** "Load Sample Procurement History" fills the ledger and AG Studio at once (AC-6.5); "Simulate Post-Approval Drift" shows the gate blocking capture (AC-5.6). Target: both verified in under 3 minutes.
- **Run locally:** `npm run dev` with a hosted Postgres `DATABASE_URL`; no Docker path is required. Judges create their own PayPal Sandbox app and, when enabled, AI/Channel3 keys. Fixture catalog plus `AI_PROVIDER=rule` mode need neither Channel3 nor Gemini credentials. Gemini is the structured-output intent parser when `AI_PROVIDER=gemini`; it is not allowed to approve or capture.
- **AG Studio key:** shared only in the private Devpost testing notes for local runs (research D4); the hosted demo already has it.
- **Fixture scenario:** "Buy 1 ergonomic desk chair for no more than $120 from northstar-office.example." The allowed fixture chair is $89; live-provider results are not promised to match fixtures.
- **Expected results table:** which offer is allowed or blocked, and why. Judges can check behavior quickly.

## 6. Video production checklist

- [ ] Script timed ≤ 2:50 ([plan.md §7](plan.md#7-demo-video-script-under-3-minutes)); open with the problem and the user within 15 s.
- [ ] Record at 1080p; browser zoom 110–125 %; hide bookmarks, extensions, other tabs, notifications.
- [ ] Show the **real** hosted app and a **real** sandbox capture; on-screen label "PayPal Sandbox — test money".
- [ ] No secrets on screen (devtools network panel filtered; no `.env`; no dashboard pages with keys).
- [ ] No copyrighted music; no third-party logos other than the sponsor tools actually used.
- [ ] Burned-in or YouTube captions (accessibility + clarity for judges).
- [ ] Upload as **Public** (not unlisted); confirm it plays while logged out.
- [ ] Record a backup cut; no earlier recording is claimed. Use the exact **2:50** click script in [plan.md §7](plan.md#7-demo-video-script-under-3-minutes).

## 7. Judging-period runbook (1–15 Dec)

| Item | Action |
|---|---|
| Hosting | Render free web service with a scheduled GitHub Actions keep-alive ping every 10 minutes (`RENDER_APP_URL` repository variable). Free services may still sleep or change behavior; verify health and cold-start timing before judging. |
| Database | Free Render Postgres may expire 30 days after creation. Record its creation date; for an early-November database, recreate around **30 Nov**, apply `npm run db:migrate`, update `DATABASE_URL`, and re-seed sample history using **Load Sample Procurement History**. Verify `/api/health`, `/api/audit/verify`, and the happy path. |
| AG Studio license | Commercial product with a 45-day trial. Record actual activation, expiry and permitted deployment scope; no 1 Nov activation is assumed. Verify coverage through 15 Dec with the issuer. |
| Uptime | GitHub Actions pings `/api/health` every 10 min when `RENDER_APP_URL` is configured; add an external monitor and alerts before judging. |
| Cost control | Set a hard spend limit / budget alert on the AI provider; keep per-session rate limits on. |
| Keys | Don't rotate keys or change sandbox passwords until after 21 Dec. |
| Code freeze | Tag `v1.0.0-submission`; Devpost links to that tag. After the deadline, keep `main` at the tag; do further work on a branch. Rules forbid changing the submission after the deadline. |
| Seed data | Daily check that the demo scenario still gives the expected results (Channel3 data can change → fixture mode switch documented). |

### Free Postgres replacement (target ~30 Nov; actual expiry takes precedence)

1. Record the current DB creation/expiry and replacement owner privately. Set a calendar reminder before expiry; this file does not create one.
2. Before expiry, preserve required old receipts and use Render's supported export/backup path if available. Do not export credentials, buyer data or connection strings into git. Replacement without restore destroys old session/purchase history.
3. Create a new free Postgres instance in the web service region; confirm its actual expiry covers 15 Dec. Put its hosted URL in private local `.env`, then run `npm run db:migrate`. Verify migration success before switching traffic.
4. Update the service's secret `DATABASE_URL` in Render and redeploy. The free-service startup command migrates before listening. Confirm `/api/health`, including database and MCP status; abort the cutover if dependencies are down.
5. In a fresh private browser session, enable demo controls and click **Load Sample Procurement History**. Seed is per session, so judges use this button in their own session; an operator seed does not populate all judges' history.
6. In **Audit ledger → Verify Audit Chain**, expect `INTACT` for the **new** session; never present it as the old chain. Repeat hosted happy-path capture and drift block from test-plan §6 and verify the Sandbox transaction.
7. Check `RENDER_APP_URL`, manually run the keepalive workflow, verify later scheduled pings, and re-check free-instance hours. Schedules may delay or disable; provide external alerts and manual coverage. Remove the old DB only after evidence preservation and successful cutover.

## 8. Third-party license register (`THIRD_PARTY_NOTICES.md`)

| Component | License / terms | Note |
|---|---|---|
| PayPal SDKs/APIs, PayPal MCP Server | PayPal Developer Agreement; MCP Server package license | Sandbox only; pinned version |
| Channel3 API | Channel3 terms | Show data, not retailer logos |
| AG Grid Community | MIT | Ledger |
| AG Studio | Commercial **trial** license | Key injected at build time from `VITE_AG_STUDIO_KEY`, not committed. Without a key the app still works, but AG Studio shows a trial watermark. Mention this in the README. |
| LLM provider | Provider API terms | No user PII sent |
| npm dependencies | Locked manifests plus installed license texts | Direct runtime licenses recorded in notices; no completed transitive license audit or CI license-policy enforcement is claimed |

## 9. Community and support

- Join the **PayPal hackathon Discord** (sponsor channels for AG Grid, Channel3, Render). Ask sponsor questions there early (before Day 1, 30 Oct), e.g. AG Studio trial for a public repo, PayPal MCP Server tool arguments, or Channel3 response fields.
- Webinars (recordings on the [resources page](https://paypalaihackathon.devpost.com/resources)): "Start building with PayPal" and "Build a payments dashboard without building a dashboard" (AG Grid) — watch both before Day 1.
