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
| C3 | Working project, runs as shown in the video | Hosted URL **and** `docker compose up` / `npm run dev` path | G2, G3, G4 | D |
| C4 | Text description of features | Devpost story (§4) | Devpost | Lead |
| C5 | **"Tools" field**: name each AI model/service and how it is used | §4.3 table | Devpost | Lead |
| C6 | Public repo on GitHub with all source, assets, instructions | `README.md` + `spec/` | Repo | D |
| C7 | OSI license **visible in the repo About section** | `LICENSE` (MIT), GitHub detects it | Repo sidebar screenshot | D |
| C8 | Video < 3 min, public on YouTube, shows the app working | [plan.md §7](plan.md#7-demo-video-script-under-3-minutes) | YouTube link | All |
| C9 | No third-party trademarks or copyrighted music in the video without permission | No music (or a CC0/royalty-free track with license saved); fixtures use **fictional `.example` merchants**; no retailer logos or product images on screen | Frame review checklist §6 | D |
| C10 | Judges get access: test credentials, keys or sandbox logins | §5 Judge Quickstart | README "Judge Quickstart & Test Scenarios" | A |
| C11 | Free, unrestricted access for testing until judging ends (15 Dec) | Render starter instance + paid Postgres (credits), uptime monitor, no paywall/login | §7 runbook | D |
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
| Built with (tags) | `paypal`, `paypal-mcp-server`, `model-context-protocol`, `paypal-orders-api`, `paypal-js-sdk`, `typescript`, `react`, `node.js`, `express`, `postgresql`, `zod`, `<ai-provider>`, `channel3`, `ag-grid`, `ag-studio`, `render`, `postman`, `playwright` |
| Try it out links | Hosted URL · GitHub repo · Postman collection |
| Video | YouTube (public) |
| Image gallery (5–7 images, 3:2) | 1 hero (flow diagram with MCP gate) · 2 mandate editor with merchant chips · 3 offers with block reasons · 4 PayPal sandbox approval · 5 pre-capture drift block (`DRIFT_AMOUNT_MISMATCH`) · 6 Governance Studio dashboard · 7 Intent Receipt with MCP trace and chain INTACT |

### 4.2 Story outline (Devpost's standard sections)

| Section | Content (keep each to 3–6 sentences; facts only) |
|---|---|
| Inspiration | AI agents can shop, but a recommendation isn't an authorization. Small-business owners need to hand off routine buying without losing control of spend. |
| What it does | The five-step flow; the three outcomes (allow / block / review); PayPal MCP tools called only by the deterministic gate; the pre-capture verification of the live order; the receipt and dashboard. |
| How we built it | Architecture diagram; LLM only drafts; pure rules engine; mandate hash; `PayPalMcpGateway` (`create_order`, `get_order`) + Orders v2 capture with `PayPal-Request-Id`; JS SDK v6 / react-paypal-js; Channel3 search; AG Studio + agent; Postgres CAS state machine; Render. |
| Challenges | E.g., keeping PayPal MCP tools away from the LLM while still using them; making capture idempotent under retries; recurrence detection without a provider field. **Write only what actually happened.** |
| Accomplishments | Measured results from CI (actual test counts), drift and tamper scenarios blocked on camera. |
| What we learned | Real learnings only. |
| What's next | Expose IntentLock itself as an MCP tool (e.g. `purchase_within_mandate`) so outside agents must go through the gate; PayPal Agent Toolkit integration; multi-currency; team approval chains. |

### 4.3 "Tools" field (required)

| Tool | Type | How it is used |
|---|---|---|
| `<LLM provider + model>` | AI model | Turns the buyer's request into a schema-validated draft mandate (structured JSON output). It never sees product data, holds no PayPal tools, and cannot approve or pay. |
| `<same or other model>` via AG Studio Agent Framework | AI agent | Answers governance questions ("why were offers blocked this week?") by building dashboard widgets from the session's audit data. Read-only. |
| PayPal MCP Server (Sandbox) | Payments tools (MCP) | `create_order` and `get_order`, called only by IntentLock's server after policy + human approval; every call is in the audit log |
| PayPal Orders v2 + JS SDK (Sandbox) | Payments | Buyer approval, server-side capture with idempotency key, fallback order read |
| Channel3 Search API | Product data | Live product offers for the policy engine |
| AG Grid / AG Studio | UI | Audit ledger and governance dashboard |
| Render | Hosting | Web service + Postgres |
| GitHub Copilot | Dev tool | Coding assistant (named for transparency) |

## 5. Judge access (goes in README and Devpost "testing instructions")

README section title: **"Judge Quickstart & Test Scenarios"** (AC-8.3).

- **Hosted demo:** URL, no login. Sessions are anonymous and isolated.
- **PayPal sandbox buyer:** email + password of a **dedicated sandbox personal account** made only for judges. Never share the sandbox **business** account or the REST app secret.
- **Optional card path:** PayPal sandbox card generator link, for judges who can't log in.
- **1-click scenario presets (AC-8.3):** Happy Path Capture, Blocked Offer, Pre-Capture Drift Rejection — each with its expected result.
- **Cold start:** "Load Sample Procurement History" fills the ledger and AG Studio at once (AC-6.5); "Simulate Post-Approval Drift" shows the gate blocking capture (AC-5.6). Target: both verified in under 3 minutes.
- **Run locally:** `docker compose up` or `npm run dev`. Judges create their own free PayPal sandbox app (≈ 5 min, link to steps), Channel3 key (free; promo `PAYPAL-HACKATHON-2026` gives 20 000 credits) and an AI key. Fixture mode (`PRODUCT_SOURCE=fixture`) needs no Channel3 key. State clearly that the LLM is required for the AI features.
- **AG Studio key:** shared only in the private Devpost testing notes for local runs (research D4); the hosted demo already has it.
- **Known-good scenario:** "Buy 2 ergonomic office chairs, max $400 total, only from acme-office.example or deskworks.example, no subscriptions."
- **Expected results table:** which offer is allowed or blocked, and why. Judges can check behavior quickly.

## 6. Video production checklist

- [ ] Script timed ≤ 2:50 ([plan.md §7](plan.md#7-demo-video-script-under-3-minutes)); open with the problem and the user within 15 s.
- [ ] Record at 1080p; browser zoom 110–125 %; hide bookmarks, extensions, other tabs, notifications.
- [ ] Show the **real** hosted app and a **real** sandbox capture; on-screen label "PayPal Sandbox — test money".
- [ ] No secrets on screen (devtools network panel filtered; no `.env`; no dashboard pages with keys).
- [ ] No copyrighted music; no third-party logos other than the sponsor tools actually used.
- [ ] Burned-in or YouTube captions (accessibility + clarity for judges).
- [ ] Upload as **Public** (not unlisted); confirm it plays while logged out.
- [ ] **Backup cut recorded at G2 (3 Nov)** so a late regression can't leave us without a video.

## 7. Judging-period runbook (1–15 Dec)

| Item | Action |
|---|---|
| Hosting | Render web service on a **starter** (paid) instance from the first hosted deploy (free tier sleeps after 15 min idle and takes ~1 min to wake) — paid with the hackathon's $50 Render credit. |
| Database | **Paid** Render Postgres from the start. Free Postgres **expires 30 days after creation** — a DB created on 3 Nov would expire on 3 Dec, in the middle of judging. |
| AG Studio license | AG Grid offers a **45-day trial**. Activate it on **1 Nov** so it covers 15 Dec; note the expiry date in the README. |
| Uptime | External uptime monitor on `/api/health` every 5 min, with alerts to two team members. |
| Cost control | Set a hard spend limit / budget alert on the AI provider; keep per-session rate limits on. |
| Keys | Don't rotate keys or change sandbox passwords until after 21 Dec. |
| Code freeze | Tag `v1.0.0-submission`; Devpost links to that tag. After the deadline, keep `main` at the tag; do further work on a branch. Rules forbid changing the submission after the deadline. |
| Seed data | Daily check that the demo scenario still gives the expected results (Channel3 data can change → fixture mode switch documented). |

## 8. Third-party license register (`THIRD_PARTY_NOTICES.md`)

| Component | License / terms | Note |
|---|---|---|
| PayPal SDKs/APIs, PayPal MCP Server | PayPal Developer Agreement; MCP Server package license | Sandbox only; pinned version |
| Channel3 API | Channel3 terms | Show data, not retailer logos |
| AG Grid Community | MIT | Ledger |
| AG Studio | Commercial **trial** license | Key injected at build time from `VITE_AG_STUDIO_KEY`, not committed. Without a key the app still works, but AG Studio shows a trial watermark. Mention this in the README. |
| LLM provider | Provider API terms | No user PII sent |
| npm dependencies | Generated list (`license-checker --summary`) | Fail CI on GPL/AGPL in runtime deps |

## 9. Community and support

- Join the **PayPal hackathon Discord** (sponsor channels for AG Grid, Channel3, Render). Ask sponsor questions there early (before Day 1, 30 Oct), e.g. AG Studio trial for a public repo, PayPal MCP Server tool arguments, or Channel3 response fields.
- Webinars (recordings on the [resources page](https://paypalaihackathon.devpost.com/resources)): "Start building with PayPal" and "Build a payments dashboard without building a dashboard" (AG Grid) — watch both before Day 1.
