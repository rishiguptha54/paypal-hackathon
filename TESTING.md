# Stage 5 verification

Observed locally on 10 Nov 2026 using Node `v24.18.0`, npm `11.16.0`, Windows and Microsoft Edge. These are **working-tree results, not last-CI results**. GitHub CLI could not retrieve a run because it is unauthenticated. Replace this provenance with the submitted commit's CI URL and observed counts only after that run finishes; do not copy local counts into a claim of green CI.

## Final observed results

| Layer / command                                                 | Actual result                                                              |
| --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `npm run typecheck`                                             | Passed for shared, API and web workspaces                                  |
| `npm run lint`                                                  | Passed                                                                     |
| `npm run format:check`                                          | Passed after approved formatting-only fixes                                |
| `npm test` — API unit + integration                             | 154 passed, 13 files; PGlite and mocked external services                  |
| `npm test` — web                                                | 6 passed, 2 files                                                          |
| `npm test` — Node release regression                            | 1 passed; bundle scanner sentinel cases                                    |
| `npm run e2e`                                                   | 9 passed; Chromium-family Edge locally, Chromium configured in Linux CI    |
| `npm run build`                                                 | Passed; Vite warns about browser chunks over 500 kB                        |
| `npm run openapi:generate`                                      | Passed using atomic replacement; no temporary output left behind           |
| `npm run openapi:check`                                         | Passed; generated OpenAPI 3.1 matches shared Zod schemas                   |
| `npm run security:bundle`                                       | Passed; 4 built browser files, including HTML and nested asset scanning    |
| `npm run test -w apps/api -- test/integration/security.test.ts` | 4 passed; SEC-09, SEC-10 and two SEC-13 properties                         |
| `node --test scripts\check-web-bundle-secrets.test.mjs`         | 1 passed; HTML, nested chunks, source maps and no matched-value disclosure |
| `npm audit --omit=dev`                                          | **Failed: 13 runtime vulnerabilities — 12 high, 1 moderate**               |

No separate unit/integration counts or coverage percentage were measured for this record. The four focused security tests are included in API's 154, not additional tests.

## Browser evidence and limits

Nine tests cover E2E-01, 02, 05, 10, 12, 13, 14, 15, 16 and 17. E2E-12 and E2E-16 share one test. They exercise the real UI approval and SDK callback wiring, receipt MCP trace, disabled policy-blocked offers, tamper ledger row, sort/filter/receipt/persistence, sample disclosure, keyboard-only purchase, axe serious/critical check, mocked Studio agent, merchant chip and all three preset outcomes. The drift test checks unchanged capture-call count and the blocked receipt.

The browser SDK is intercepted, Sandbox REST is MSW-mocked, MCP is a stdio stub, and Studio responses are scripted. This is not a real PayPal approval/capture or real Gemini/Channel3 verification. PGlite is not hosted Postgres certification. E2E-03, 04, 06–09 and 11 are not claimed as browser coverage.

## Security sweep

- SEC-04: scans built HTML/JS/CSS/source maps, including nested chunks, for server-secret names and credential formats. Regression tests use harmless sentinels. An AG Studio browser license is intentionally public client configuration, **not** a server credential or permission to redistribute a license.
- SEC-09: the captured logger now reaches the REST client as in production. A full capture checks token, secret, payer-email, given-name and surname sentinels are absent, while confirming PayPal debug evidence is logged.
- SEC-10: capture-flow data in all seven application tables is checked independently for payer email and both name sentinels.
- SEC-13: arbitrary Unicode grapheme request text and mandate fields must return 2xx/4xx, never 5xx (20 generated runs per property).
- Existing session-isolation integration tests also pass in the full API suite.

The read-only sweep found three LOW-severity validation/documentation gaps, not confirmed exploitable leaks. All three were addressed. The dependency audit is a **separate unresolved blocker**: advisories affect `@paypal/mcp` / `@paypal/agent-toolkit` transitive packages, including LangChain, LangSmith, AI SDK utilities, jsondiffpatch, mathjs, uuid and older Zod. Several paths report no available fix. No audit suppression, incompatible major override or unverified production mitigation was applied. A vulnerability count does not establish app-level exploitability.

## Commands and retries

The final successful commands are listed above. Additional checks and failed attempts during this task:

| Command / operation                                                                                                                                                                  | Result and action                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial `npm run typecheck`; `npm run lint`                                                                                                                                          | Typecheck passed; lint found four issues in pending Stage 5 files. Fixed unused value, logger output and const declaration; rerun passed.                                                                              |
| Initial `npm test`                                                                                                                                                                   | 14 suites failed before tests with `UNKNOWN: unknown error, read`; the new security file's 4 tests passed.                                                                                                             |
| `npm run test -w apps/api -- --pool=threads`; `npm run test -w apps/web -- --pool=threads`                                                                                           | Same read error; did not change repository worker defaults.                                                                                                                                                            |
| `npm run test -w apps/api -- test/unit/config.test.ts --reporter=verbose --no-cache`                                                                                                 | Same read error.                                                                                                                                                                                                       |
| `npm run test -w apps/api -- test/unit/config.test.ts` with a temporary Node read tracer                                                                                             | Identified unreadable OneDrive-backed files in the exact `node_modules\.vitest-cache` directory, not test-source failures.                                                                                             |
| `Remove-Item -LiteralPath 'C:\Users\H658998\OneDrive - Honeywell\Desktop\Paypal\node_modules\.vitest-cache' -Recurse -Force`; `npm test`                                             | Removed only that inspected generated cache. Full suites then passed (154 API + 6 web before adding the Node regression).                                                                                              |
| Repeated `npm run e2e`                                                                                                                                                               | Initial pending suite: 4 passed, 4 failed. Strengthening checkout exposed mock-SDK version/disabled-state and virtual-column assertion issues. Fixed; final suite 9 passed without retries locally.                    |
| Initial `node --test scripts\check-web-bundle-secrets.test.mjs`                                                                                                                      | Found digit-containing secret names were missed; fixed the pattern, then passed all sentinel cases.                                                                                                                    |
| Initial `npm run openapi:generate`                                                                                                                                                   | Direct overwrite failed with a OneDrive `UNKNOWN` open error. Changed generation to same-directory temporary output plus atomic rename and cleanup; generation and drift check then passed.                            |
| Initial `npm run format:check`                                                                                                                                                       | Failed on 14 pre-existing application files. User approved formatting-only updates; rerun passed.                                                                                                                      |
| `npx prettier --write --ignore-unknown` on the changed-file list                                                                                                                     | Formatted only release worktree files, excluding the lockfile and spec docs. Generated OpenAPI is excluded from formatting and checked by the generator.                                                               |
| `npx prettier --write` on the 14 approved existing files                                                                                                                             | Formatting-only; full typecheck, lint, tests and build subsequently passed.                                                                                                                                            |
| `gh run list --repo rishiguptha54/paypal-hack --workflow ci.yml --limit 3 --json databaseId,headSha,conclusion,status,url`                                                           | Failed: GitHub CLI authentication unavailable.                                                                                                                                                                         |
| `gh api --hostname github.com repos/rishiguptha54/paypal-hack/actions/workflows/ci.yml/runs --method GET -f per_page=1 --jq '.workflow_runs[] \| {id,conclusion,head_sha,html_url}'` | Failed for the same authentication reason.                                                                                                                                                                             |
| `node --version`; `npm --version`; `Get-PSDrive C`                                                                                                                                   | Confirmed runtime versions above; initially about 1.4 GB disk free. No package/browser install was attempted.                                                                                                          |
| Node read probes and installed-manifest license inspection                                                                                                                           | Source files readable; verified direct runtime license identifiers and detected no manifest license identifier for `@paypal/mcp`.                                                                                      |
| Node/YAML/JSON release configuration assertions                                                                                                                                      | Passed: CI invokes E2E, Render uses free/native startup migration without a pre-deploy hook, keepalive cron is ten minutes, and Postman contains four scenario folders. This checks structure, not a live Postman run. |
| `Get-ChildItem`, `Select-String`, trace ZIP console inspection                                                                                                                       | Read-only package/source/cache diagnostics. One guessed SDK declaration path did not exist; corrected using installed package layout. No credentials were read.                                                        |
| `git status --short`; `git remote -v`; `git diff --stat`; `git diff --check`; `git ls-files .env`                                                                                    | Personal GitHub remote confirmed; existing edits preserved; diff hygiene passed; `.env` is not tracked. User confirmed the current storage location is approved.                                                       |

Official Render documentation was checked: free services do not support pre-deploy commands; startup now migrates before listening. Free service idle limits and 30-day Postgres expiry are disclosed. Installed PayPal v6 loader/session code was checked for the SDK mock contract.

## Not run / release gates still pending

- No clean-clone `npm ci` dry run, real hosted `npm run db:migrate`, external DB mutation, deployment or calendar reminder was performed.
- No local gitleaks, coverage run, transitive license audit or browser install; CI retains its gitleaks and dependency-audit jobs.
- No verified last-CI result: the audit job is expected to remain red until dependencies are safely resolved. CI is configured to run E2E and retain Playwright results, not proven green.
- Hosted live smoke, private-window judge run, actual AG Studio license expiry, public video, Devpost submission and `v1.0.0-submission` are pending.
- T074 webhooks remain deferred per their P2 gate. No `.env` or other secrets were committed; no commit/tag/push was created.
