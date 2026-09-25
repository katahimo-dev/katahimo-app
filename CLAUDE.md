# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

`katahimo-app` is the rebuild of the childcare home-visit staff webapp `gas-childcare-visit-app` (Google Apps Script, single tenant, Sheets/Drive/Calendar as the data store) as a multi-tenant web app with PostgreSQL as the source of truth. The GAS app lives in the read-only submodule `legacy/gas-childcare-visit-app` and is the **specification**: screens, wording, and business results must match it; the implementation must not copy its GAS-isms (see "Porting rules").

Status (2026-09-25): all screens the GAS `index.html` calls are rebuilt with visual parity, all server logic is ported, schedule/route runs without GAS (Google Calendar + Maps APIs), and GCP deployment (Cloud Run + Cloud SQL, Terraform) is written but not yet applied. `README.md` has the setup, parity status and GAS-trigger decommission table; `CHANGELOG.md` has history.

Code comments, docs, README/CHANGELOG entries and commit messages are written in **Japanese** — keep new ones in Japanese. This file is the exception (English).

TypeScript, pnpm 11 workspaces (`packages/*`, `tools/*`), Node 22+. Packages (`@katahimo/*`):

| Package | Contents |
| --- | --- |
| `shared` | zod API contracts (`src/contracts/`) and defaults (AI prompts, assessments, password rules). Imported by both api and web. |
| `core` | `domain/` pure functions (attendance, schedule, pii, reports, legacyAuth, outbox retry…), `ports/` interfaces, `usecases/`. No I/O. `testSupport/gasLegacy.ts` loads legacy GAS code into `node:vm` for parity tests. |
| `db` | Drizzle schema (`src/schema/`), migrations (`drizzle/`), repositories (port implementations), `withTenant()` (`src/client.ts`), connection parsing incl. Cloud SQL sockets (`src/connection.ts`). |
| `integrations` | Port implementations for Google Calendar/Maps/Drive/Gemini/Chat, GCS, Cloud KMS, SMTP, local dev (crypto/KMS/storage), noop, GAS Bridge, and provider selection (`schedule-provider`, `storage-provider`, `kms-provider`). |
| `ingestion` | RESERVA customer CSV and GAS staff-master CSV parsing/import; latest-CSV auto import. |
| `api` | Hono server. `src/container.ts` is the composition root, `src/routes/*`, `src/session.ts`, `src/http/` (error helpers, static web serving), `src/scripts/` (seed, CSV imports). |
| `worker` | Resident outbox poller (`src/main.ts`) and one-shot jobs (`src/entrypoints/`). |
| `web` | React 19 + Vite 7 + TanStack Query + Tailwind **v3** PWA. Its own conventions are in `packages/web/README.md` — read it before touching UI. |
| `tools/gas-preview` | Side-by-side screenshot harness (GAS vs new app) and the live e2e journey. |

## Commands

```bash
pnpm install
pnpm typecheck            # tsc --noEmit in every package
pnpm test                 # vitest, packages/*/src/**/*.test.ts (no DB needed)
pnpm lint                 # biome check . (lint:fix to apply); legacy/ and drizzle/ are excluded
pnpm build                # tsup (api/worker/db) + vite (web)
pnpm vitest run packages/core/src/domain/attendance   # a subset

pnpm db:migrate           # applies packages/db/drizzle with MIGRATION_DATABASE_URL (owner role)
pnpm db:seed              # tenant `demo`, admin@example.com / admin1234, 3 customers (idempotent)
pnpm db:generate          # drizzle-kit diff migration from the schema

pnpm --filter @katahimo/api dev        # :8080
pnpm --filter @katahimo/web dev        # :5173, proxies /api to :8080 (WEB_DEV_PORT / WEB_API_PROXY_TARGET)
pnpm worker                            # outbox poller
pnpm job:nightly-calendar-sync [-- YYYY-MM-DD] | pnpm job:csv-import
pnpm --filter @katahimo/worker outbox:once | job:sync-busy-blocks
pnpm --filter @katahimo/api import:reserva -- <slug> <csv> [--force]
pnpm --filter @katahimo/api import:staff-master -- <slug> <csv> [--dry-run]
```

CI (`.github/workflows/ci.yml`, README "CI とブランチ保護") runs lint → typecheck → migrate on PostgreSQL 17 (same major as Cloud SQL) → `pnpm db:generate` drift check (fails if schema changes lack a committed migration) → test → build, then the gas-preview `shoot`/`e2e` job (non-blocking for now; CI installs its own Chromium). `infra.yml` runs `terraform fmt -check`/`validate` with the committed `infra/gcp/.terraform.lock.hcl`. The legacy submodule is fetched with `secrets.SUBMODULE_TOKEN`; without it the parity tests skip with a warning — so parity tests must tolerate a missing submodule at collection time (load GAS sources lazily, not at `describe` level).

Local DB: PostgreSQL 16+ on :5432 (`infra/initdb/00_create_database.sql` then `01_bootstrap.sql` as superuser) or `docker compose -f infra/docker-compose.yml up -d` (:5433). `.env` from `.env.example`; minimum is `DATABASE_URL` (app role `katahimo_app`), `MIGRATION_DATABASE_URL` (owner `katahimo`), `SESSION_SECRET`, `LOCAL_DEV_MASTER_KEY`, `LOCAL_DEV_KEK` (two different 64-hex keys). Without Google/Gemini/SMTP settings everything falls back to noop/console implementations.

**pnpm 11 gotcha**: `pnpm <script> -- --opt` passes the literal `--` through to the script. Any CLI you write must drop `--` from `process.argv` before parsing (`importStaffMasterCsv.ts`, `importReservaCsv.ts`, `tools/gas-preview/src/shoot.ts` do `argv.slice(2).filter((a) => a !== '--')`). When in doubt run the tool directly: `cd tools/gas-preview && npx tsx src/shoot.ts --only '^att-'`.

Built `dist/` output does not bundle external deps and cannot run from the pnpm workspace `node_modules`; to run it outside Docker, install prod deps flat (`pnpm install --prod --config.node-linker=hoisted --filter '@katahimo/api...'`) next to it, like the `Dockerfile` does. `WEB_DIST_DIR` makes the API serve the built SPA (same origin, `/api/*` first).

## Architecture and conventions

### Multi-tenancy (RLS)

- Every tenant table has `tenant_id` and the policy `tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid` (`packages/db/src/schema/_rls.ts`). The `nullif` matters: after a `SET LOCAL` a pooled connection's setting reverts to `''`, not NULL, and `''::uuid` would throw.
- All tenant-scoped queries run inside `withTenant(db, tenantId, tx => …)`, which sets `app.tenant_id` with `set_config(..., true)` (transaction-local, safe with pooling). A query outside `withTenant` sees zero rows — that is the intended failure mode, not something to work around.
- The app connects as the non-owner `katahimo_app`; migrations run as owner `katahimo`. `FORCE ROW LEVEL SECURITY` is set on every table (`drizzle/0001_custom_constraints.sql`), so even the owner is filtered. Never grant BYPASSRLS or connect the app as owner.
- `tenantId` comes **only** from the session cookie, never from request bodies/queries.
- Composite keys: every tenant table has `UNIQUE (tenant_id, id)` and child→parent references are composite FKs `(tenant_id, x_id) → parent(tenant_id, id)` (FK checks bypass RLS, so single-column FKs could point at another tenant's row). Follow this for new tables (doc/09 §1.2, doc/10 §1).

### PII encryption

- Sensitive fields are stored as `*_ciphertext` + `*_key_version`, encrypted with `CryptoPort` (AES-256-GCM, randomized) using a per-tenant DEK that is envelope-encrypted by a KEK (`KMS_PROVIDER=local` → `LOCAL_DEV_KEK`, `gcp` → Cloud KMS) and stored in `tenant_keys`.
- Equality search uses a separate blind index column (HMAC-SHA256 via `BlindIndexPort`, key `LOCAL_DEV_MASTER_KEY`, separate from the KEK). Always normalize with `core/domain/pii/normalize.ts` before computing; names are split into family/given indexes (`japaneseName.ts`).
- Never log decrypted values; `app_logs.details` holds IDs, counts and reason codes only. Changing either key or `KMS_PROVIDER` breaks existing data.

### Security: admin-vs-self

Never trust a client-supplied staff id (the GAS app's rule, "never trust a client-supplied staff name", carried over). In routes use the helpers in `packages/api/src/session.ts`:

- `requireSession(container, deniedAction?)` / `requireAdmin(container, action)` middlewares (401/403 + WARN `<action>.access_denied` log); read the session with `c.get('session')`.
- `resolveAttendanceTargetStaffId` / `resolveScheduleTargetStaffId` / `resolveReportTargetStaffId`: non-admins are forced to their own `staffId`; only admins may target another staff. Report/receipt usecases apply the same rule from the actor, and non-admins cannot overwrite others' reports.
- Admin-only endpoints: `/api/admin/*`, `/api/settings/admin/*`, `POST /api/attendance/day/aggregate/refresh`. The web hides admin UI via `useSession().user.isAdmin`, but the server check is the real one.

### Logging

Use `AppLogPort.write({ tenantId, level, action, actorStaffId, targetStaffId, details, ip, userAgent })` (`core/ports/appLog.ts`, stored in `app_logs`, UPDATE revoked). Levels `INFO | WARN | ERROR | SECURITY`. Rules (same as GAS `logToBuffer`): always log WARN/ERROR/denials and all writes; log read successes only when they cost money (Maps calls) or when an admin reads another staff's data (`targetStaffId`). Action names are dotted (`report.daily.saved`, `schedule.route.failed`). The port never throws. Process logs are one-line JSON for Cloud Logging.

### API contracts and errors

- Request/response shapes are zod schemas in `packages/shared/src/contracts/`. The API validates input with `parseJsonBody` / `parseQuery` (`api/src/http/responses.ts`); the web validates every response against the same schema in `web/src/api/client.ts`. A new endpoint needs a contract first.
- Errors are always `{ code, message, fields? }` via `apiError(c, status, code, message, fields)`; codes include `unauthenticated` 401, `forbidden` 403, `not_found` 404, `validation_failed` 400, `locked` 400, `conflict` 409, `upstream_unavailable` 502. `message` is user-facing Japanese; the web shows it via `userMessageOf`.
- Endpoint specs: `doc/api/*.md` — update them with behavior changes.

### Attendance (出勤簿) column letters

`rowData` keys are the spreadsheet column letters (`C`, `D`, … `AO`). The mapping letter ↔ meaning lives in exactly two places: `packages/core/src/domain/attendance/sheetLayout.ts` (server) and `packages/web/src/features/attendance/model/dayRecord.ts` (UI). Everything else uses the named definitions (`VISIT_SLOTS`, `MOVE_LEGS`, `SLOT_DEFS`…); don't write column letters anywhere else. Month lock: only the current JST month is editable (`monthLock.ts`); calendar sync is exempt, as in GAS.

### Schedule / route provider

`SCHEDULE_PROVIDER` = `google` (Calendar API + Geocoding/Routes API, `integrations/src/google-schedule`) | `gas_bridge` (delegate to the GAS Web App) | `noop` (always empty). If unset it is inferred from credentials (`integrations/src/schedule-provider/scheduleProvider.ts`); production requires it explicitly. Screen reads may use the 2-hour in-process route cache; **anything written to official records (calendar→attendance sync, nightly job) must use `getFreshScheduleWithRouteForStaff` / `{ fresh: true }`**, which neither reads nor writes the cache and fails (502) instead of returning partial data when a calendar can't be read. Details: `doc/api/schedule-route.md`.

### Mirror to GAS sheets (outbox)

PostgreSQL is the source of truth. Writes that GAS-side sheets still need (`attendance_day`, `attendance_aggregate`, `daily_report`, `accident_report`, `receipt`) enqueue an `outbox_jobs` row via `MirrorPort` **in the same transaction** as the domain write, only when `MIRROR_TO_GOOGLE_SHEETS=true`. The worker (`core/usecases/mirrorWorker.ts`) re-reads the record and posts to the GAS `Bridge.js` actions (`integrations/src/gas-bridge/gasBridgeMirrorSenderPort.ts`); without `GAS_BRIDGE_URL` sending is a no-op. Retries use exponential backoff (`core/domain/outbox/retryPolicy.ts`, `OUTBOX_MAX_ATTEMPTS` then `failed` + ERROR `mirror.job_failed`); stuck `processing` jobs are reclaimed after 10 min. The Bridge write actions are not deployed on the GAS side yet (`doc/api/attendance-batch.md` lists the required GAS changes, made in the GAS repo).

### Worker jobs

`packages/worker/src/entrypoints/`: `nightlyCalendarSync.ts` (GAS `autoSyncTodayScheduleForAllStaff`, 22:00 JST), `csvImport.ts` (GAS `checkAndImportLatestCsv`, 03:00 JST; Drive via `CUSTOMER_CSV_DRIVE_FOLDERS` or local `CUSTOMER_CSV_LOCAL_DIR/<slug>/Kokyaku_*.csv`; refuses to apply if >20% of customers would disappear → `review_required`), `syncBusyBlocks.ts` (free/busy for future matching), `outboxOnce.ts`. Jobs are idempotent, exit 1 on any failure (Cloud Run Jobs retry), and are scheduled by Cloud Scheduler in production (`infra/gcp/scheduler.tf`); `WORKER_IN_PROCESS_CRON=true` runs them inside the poller locally. The GAS triggers they replace must be disabled on cut-over day (`doc/11` §7).

### Migrations

- Edit `packages/db/src/schema/*.ts`, then `pnpm db:generate` to create the next migration; commit schema + SQL + `drizzle/meta`. Check with `pnpm db:generate` that it reports "No schema changes" when you think you're done.
- Things drizzle-kit can't express (EXCLUDE constraints, `FORCE ROW LEVEL SECURITY` for new tables, privilege revokes) go in a new hand-written SQL migration (`pnpm --filter @katahimo/db exec drizzle-kit generate --custom --name <name>`), like `0001_custom_constraints.sql`. New tables need their `FORCE ROW LEVEL SECURITY` line.
- **Never edit an applied migration** (`0000_initial_schema.sql`, `0001_custom_constraints.sql`, …). Migrations run before the new app version deploys, so keep them backward compatible (add column → deploy → drop old column next release).
- Enum-like values are `text` + `CHECK`, time ranges are `tstzrange` half-open `[start, end)`.

### Future admin assignment (matching) app

The schema already holds the matching extension (doc/10): tenant status/timezone/business type, `tenant_features`, `custom_fields`, staff attributes and availability, `staff_busy_blocks`, customer preferences/required attributes, customer×staff affinities, `reservations` / `reservation_assignments` (double booking blocked by an EXCLUDE constraint), `matching_runs`. When the admin app is built, add its tables following the same rules (tenant_id + RLS + FORCE, composite FKs, encrypted free text) and keep them consistent with doc/10.

## GAS parity verification

- **Logic parity tests** run the legacy GAS source itself in `node:vm` with fake GAS services and compare outputs with the TypeScript port: `packages/core/src/domain/attendance/gasParity.test.ts` (seeded random inputs through `testSupport/gasLegacy.ts`) and `packages/integrations/src/google-schedule/gasParity.test.ts` (`RouteSearch.js` scenarios). They are skipped if the submodule is missing, so run `git submodule update --init` before trusting a green run. When porting more GAS logic, add a parity test in the same style rather than eyeballing.
- **UI parity**: `tools/gas-preview` serves the GAS `index.html` with a mocked `google.script.run` and screenshots it next to the new app (Vite dev server with mocked `/api`) at 390×844, same fixtures, clock fixed at 2026-09-25 10:00 JST. Run `pnpm --filter @katahimo/gas-preview shoot` (starts Vite itself; `--web-url` to reuse a running server; `--only '<regex>'`, `--max-diff` default 0.05 — exits 1 on any shot above it; `--concurrency`). `e2e` likewise starts Vite and the API if needed. Output in `tools/gas-preview/out/` (gitignored); every shot should stay ≤ 0.05% diff. New screens get shots in `src/shots/<feature>.ts` plus mocks in `gasMock.ts` / `webMock.ts` (web mocks are validated against the zod contracts). Known deliberate differences are listed in the READMEs.
- **Live journey**: `pnpm --filter @katahimo/gas-preview e2e` (API :8080 + web :5173 running, seeded DB) drives login → schedule → customers → report/receipts → attendance → settings → logout, then a non-admin checks hidden admin UI and 403s. Screenshots in `out/e2e/`. It writes to the DB — dev only.
- Chromium is preinstalled at `/opt/pw-browsers` and `playwright-core` is pinned to 1.56 to match; never run `playwright install`.

## Porting rules

- **Submodule**: `legacy/gas-childcare-visit-app` is read-only. Never edit it here; fixes go to `katahimo-dev/gas-childcare-visit-app`, then `git submodule update --remote legacy/gas-childcare-visit-app` and commit the pointer bump. The GAS app source is in `legacy/gas-childcare-visit-app/gas-childcare-visit-app/`; its `CLAUDE.md` has the file map and caching layers.
- **Clean code over GAS-isms**: reproduce GAS *behavior* (UI classes and exact Japanese wording, outputs, validation messages, edge cases), not its *implementation*. No `innerHTML` string building (JSX), no identity by staff/customer name or sheet row number (use IDs), no column letters outside the layout layer, no client-trusted identity, no whole-sheet rewrites (diff-apply), no hidden global state. Put logic in pure `core/domain` functions with tests, I/O behind ports. When GAS has a bug, fix it and document the deliberate difference (web README / doc/api / gas-preview README) instead of copying it.
- UI work follows `packages/web/README.md` (GAS class names verbatim, Tailwind v3 default theme, `FadeModal`, `showToast`, `STORAGE_KEYS` for every localStorage key, `AdminTargetStaffSelect` + `requestStaffId` for admin targeting, TanStack Query keys under `queryKeys.customers.all` for customer data).
- Secrets only via env / Secret Manager. Production (`NODE_ENV=production`) refuses to start without `KMS_PROVIDER=gcp`, `STORAGE_PROVIDER=gcs`, explicit `SCHEDULE_PROVIDER`, a 32+ char `SESSION_SECRET` (API), and `SMTP_HOST` (worker — password-reset mail is enqueued to the outbox by the API and sent by the worker, so the outbox poller must run in production).
- Record user-visible or operational changes in `CHANGELOG.md` (`## [Ver. x.y.z] - date`, Japanese).

## References

- `doc/07`–`doc/09`: design documents inherited from the earlier prototype (tech stack, multi-tenancy, DB schema, encryption). `doc/10`: matching extension schema. `doc/11`: GCP deployment and GAS cut-over checklist. `doc/api/*.md`: API specs. (`doc/reference/` no longer exists.)
- The earlier prototype (`katahimo-dev/C001-cutest-internal`, `01_GAS/katahimo-app`) was imported as this repo's base; its UI was discarded and rebuilt from the GAS app.
- `ohru131/katahimo-app` (public): demo version, UI/design reference only.
