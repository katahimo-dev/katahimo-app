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
| `db` | Drizzle schema (`src/schema/`), migrations (`drizzle/`), the Unit of Work (`src/uow.ts`) and tenant-bound repositories (`src/repositories/tenant/*`), cross-tenant platform repositories (`src/repositories/platform/*`: tenants, outbox queue, rate limiter, app log, maintenance), DB-error mapping (`src/errors.ts`), connection parsing incl. Cloud SQL sockets (`src/connection.ts`), DB integration tests (`src/integration/`). |
| `integrations` | Port implementations for Google Calendar/Maps/Drive/Gemini/Chat, GCS, Cloud KMS, SMTP, local dev (crypto/KMS/storage), noop, GAS Bridge, provider selection (`schedule-provider`, `storage-provider`, `kms-provider`), and the env shared by api and worker (`runtime-env/sharedEnv.ts`). |
| `ingestion` | RESERVA customer CSV → `CustomerSnapshot` and one-transaction diff-apply (`applyReservaImport`), GAS staff-master CSV parsing, latest-CSV auto import. |
| `api` | Hono server. `src/container.ts` is the composition root (ports only), `src/routes/*`, `src/session.ts`, `src/http/` (`responses.ts` jsonOk/parse helpers, `requestLog.ts` request log + `onApiError`, security headers, static web serving), `src/scripts/` (seed, CSV imports). |
| `worker` | Resident outbox poller (`src/main.ts`) and one-shot jobs (`src/entrypoints/`), with its own DB user (`WORKER_DATABASE_URL`). |
| `web` | React 19 + Vite 7 + TanStack Query + Tailwind **v3** PWA. Its own conventions are in `packages/web/README.md` — read it before touching UI. |
| `tools/gas-preview` | Side-by-side screenshot harness (GAS vs new app) and the live e2e journey. |

## Commands

```bash
pnpm install
pnpm typecheck            # tsc --noEmit in every package
pnpm test                 # vitest projects: unit + web, and integration (*.integration.test.ts) when DATABASE_URL and MIGRATION_DATABASE_URL are set
pnpm lint                 # biome check . (lint:fix to apply); legacy/ and drizzle/ are excluded
pnpm build                # tsup (api/worker/db) + vite (web)
pnpm vitest run packages/core/src/domain/attendance   # a subset
pnpm vitest run --project integration                 # DB integration tests only (RLS, constraints, concurrency, API routes)

pnpm db:migrate           # applies packages/db/drizzle with MIGRATION_DATABASE_URL (katahimo_migrator → owner)
pnpm db:seed              # platform.provision_tenant() → tenant `demo`; admin@/coordinator@/staff@example.com, password admin1234; 3 customers (idempotent)
pnpm db:generate          # drizzle-kit diff migration from the schema

pnpm --filter @katahimo/api dev        # :8080
pnpm --filter @katahimo/web dev        # :5173, proxies /api to :8080 (WEB_DEV_PORT / WEB_API_PROXY_TARGET)
pnpm worker                            # outbox poller
pnpm job:nightly-calendar-sync [-- YYYY-MM-DD] | pnpm job:csv-import
pnpm --filter @katahimo/worker outbox:once | job:maintenance | job:sync-busy-blocks
pnpm --filter @katahimo/api import:reserva -- <slug> <csv> [--force]
pnpm --filter @katahimo/api import:staff-master -- <slug> <csv> [--dry-run]
```

CI (`.github/workflows/ci.yml`, README "CI とブランチ保護") runs lint → typecheck → migrate on PostgreSQL 17 (same major as Cloud SQL) → `pnpm db:generate` drift check (fails if schema changes lack a committed migration) → test (including the DB integration project) → build, then the gas-preview `shoot`/`e2e` job (non-blocking for now; CI installs its own Chromium). `infra.yml` runs `terraform fmt -check`/`validate` with the committed `infra/gcp/.terraform.lock.hcl`. The legacy submodule is fetched with `secrets.SUBMODULE_TOKEN`; without it the parity tests skip with a warning — so parity tests must tolerate a missing submodule at collection time (load GAS sources lazily, not at `describe` level).

Local DB: PostgreSQL 16+ on :5432 (`infra/initdb/00_create_database.sql` then `01_bootstrap.sql` as superuser; pass `-v dbname=<name>` to 00 for a scratch DB) or `docker compose -f infra/docker-compose.yml up -d` (:5433). `.env` from `.env.example`; minimum is `DATABASE_URL` (`katahimo_app`), `WORKER_DATABASE_URL` (`katahimo_worker`), `MIGRATION_DATABASE_URL` (`katahimo_migrator`), `SESSION_SECRET`, `BLIND_INDEX_MASTER_KEY`, `LOCAL_DEV_KEK` (two different 64-hex keys). Without Google/Gemini/SMTP settings everything falls back to noop/console implementations. Target is Cloud SQL PostgreSQL 17 (CI `postgres:17`) and it must also work on 16: don't use PG18 features (no `uuidv7()` in SQL — ids are UUIDv7 generated in the app, `core/domain/ids`; the DB default is `gen_random_uuid()`).

**pnpm 11 gotcha**: `pnpm <script> -- --opt` passes the literal `--` through to the script. Any CLI you write must drop `--` from `process.argv` before parsing (`importStaffMasterCsv.ts`, `importReservaCsv.ts`, `tools/gas-preview/src/shoot.ts` do `argv.slice(2).filter((a) => a !== '--')`). When in doubt run the tool directly: `cd tools/gas-preview && npx tsx src/shoot.ts --only '^att-'`.

Built `dist/` output does not bundle external deps and cannot run from the pnpm workspace `node_modules`; to run it outside Docker, install prod deps flat (`pnpm install --prod --config.node-linker=hoisted --filter '@katahimo/api...'`) next to it, like the `Dockerfile` does. `WEB_DIST_DIR` makes the API serve the built SPA (same origin, `/api/*` first).

## Architecture and conventions

### Multi-tenancy (RLS) and roles

- Every table in `public` has `tenant_id` and the policy `tenant_isolation`: `tenant_id = app_current_tenant()` where `app_current_tenant()` is `nullif(current_setting('app.tenant_id', true), '')::uuid` (the `nullif` matters: after a transaction-local setting a pooled connection reverts to `''`). No setting → no rows visible, nothing writable. `FORCE ROW LEVEL SECURITY` everywhere, so even the owner is filtered. `platform.*` (tenants, plans, rate limits, lifecycle events) has no RLS and is read-only for the app.
- Roles (doc/09 §1.4): `katahimo_owner` (NOLOGIN, owns everything), `katahimo_migrator` (LOGIN, member of owner, `SET ROLE` on login; migrations and `platform.provision_tenant()`), `katahimo_app` (API), `katahimo_worker` (worker/jobs; has the cross-tenant `outbox_messages_worker` policy; no access to `staff_credentials`), `katahimo_readonly` (placeholder). None has SUPERUSER/BYPASSRLS. Grants are explicit per table in `0001_baseline_custom.sql` (no default privileges); append-only tables (`care_record_revisions`, `entity_changes`, `ai_prompt_revisions`, `app_logs`) get SELECT/INSERT only. New tables need their GRANTs and `FORCE ROW LEVEL SECURITY`; `packages/db/src/integration/catalog.integration.test.ts` checks this from the catalog.
- Tenants are created only by `platform.provision_tenant()` (SECURITY DEFINER) via `core/usecases/tenantProvisioning.ts` (the app generates and KMS-wraps the first DEK).
- `tenantId` comes **only** from the session cookie, never from request bodies/queries.
- Composite keys: tenant tables have PK `(tenant_id, id)` and every FK to a tenant table is `(tenant_id, x_id) → (tenant_id, id)`. Every `tenant_id` references `platform.tenants`. Default PostgreSQL naming (`_pkey`, `_fkey`, `_idx`, `_check`, `_excl`; `constraintName()` in `schema/_columns.ts` drops `tenant_id` if a name exceeds 63 bytes).
- Types: enum-like `text` + `CHECK` (values in `core/domain/model/codes.ts`), `timestamptz` / `date` / `time`, ranges `tstzrange` / `daterange` half-open `[start, end)`, `row_version` on concurrently edited rows, `updated_at` maintained by the `set_updated_at()` trigger, `archived_at` for soft deletes, `staff.retired_on`.

### Unit of Work (all DB access)

- Usecases never touch Drizzle. They call `deps.uow.run(tenantId, async (r) => …, { actorId })` (`core/ports/unitOfWork.ts`, `db/src/uow.ts`): one transaction, tenant (and `app.actor_id` for triggers) set once, and `r` is a set of repositories bound to that transaction that **take no tenantId**. Throwing rolls everything back, including outbox rows.
- Domain writes and their outbox messages go in the same `run`. External calls (Calendar, Maps, Gemini, Chat, storage uploads) happen outside `run`; for uploads, put the blob first and delete it if the transaction fails (see `usecases/receipts.ts`).
- Optimistic concurrency: rows with `row_version` are updated with an expected version (`update(id, patch, expectedVersion)`); a mismatch is `DomainError('conflict')` → 409 with a Japanese "reload and retry" message. Contracts expose `rowVersion` in views and accept an optional `rowVersion` in update requests. Attendance days are also locked with `SELECT … FOR UPDATE` (`attendance.lockDay`).
- DB rejections are mapped once in `db/src/errors.ts` (`KH001` locked month, `KH002` locked record, `23P01` EXCLUDE → conflict, login-email PK → conflict).
- Tests use the in-memory `MemoryDatabase` / `FakeUnitOfWork` (rollback via snapshot) from `core/src/usecases/testDoubles.ts` and the all-in-one deps from `testContext.ts` (exported as `@katahimo/core/test-utils`).
- In raw `sql` templates inside a single-table select, Drizzle renders columns unqualified — in correlated subqueries write outer columns as `"table"."column"` explicitly (see `repositories/tenant/customers.ts`). The query builder (`notExists(...)` etc.) qualifies correctly.

### PII encryption

- Sensitive fields are `*_enc bytea` in a self-describing v3 format: `[0x03][DEK version u16][nonce 12][AES-256-GCM ciphertext | tag 16]` with AAD `katahimo/field/v3\0<tenantId>\0<table.column>\0<rowId>` (`integrations/src/local-crypto/localCryptoPort.ts`). Purposes (`table.column`) are defined once in `core/domain/pii/encryptionPurposes.ts`; the row id is the primary key (or natural key). Encrypt with the row's id known up front (ids are app-generated).
- Per-tenant DEKs live in `tenant_data_keys` (multiple versions; one `active`, older `decrypt_only`, `destroyed` for crypto-shredding), wrapped by the KEK (`KMS_PROVIDER=local` → `LOCAL_DEV_KEK`, `gcp` → Cloud KMS; `kek_key_name` records which). Unwrapped DEKs are cached per version with single-flight promises.
- Blind index (receipt dedupe only): `[key version byte] | HMAC-SHA256(HKDF(BLIND_INDEX_MASTER_KEY, tenant, purpose), value)` (`localBlindIndexPort.ts`). Normalize before computing.
- Decrypts are audited once per operation (`DecryptSession` in `core/usecases/cipher.ts` → `AuditLogPort.recordDecrypt({ operation, count })`), not per value. Never log decrypted values; `app_logs.details` holds IDs, counts and reason codes only. Changing a key or `KMS_PROVIDER` breaks existing data.

### Security: admin-vs-self

Never trust a client-supplied staff id (the GAS app's rule, "never trust a client-supplied staff name", carried over). Roles are `staff` | `coordinator` | `admin` (`@katahimo/shared` `isAdminRole` / `canActForOthers`; core re-exports them):

- `requireSession(container, deniedAction?)` / `requireAdmin(container, action)` middlewares (401/403 + WARN `<action>.access_denied` log); `actorOf(c)` gives the usecase `Actor` (`{ tenantId, staffId, role, meta }`).
- `targetStaffIdOf(c, requestedStaffId)` (→ `core/domain/staff/roles.ts` `resolveTargetStaffId`) is the single helper: `staff` is forced to their own id; `coordinator`/`admin` may target another staff. Usecases re-check (`loadAttendanceTarget` throws forbidden), and report overwrites cannot change the customer or author (409 `customer_mismatch` / `author_mismatch`); staff cannot overwrite others' reports (403).
- Admin-only endpoints: `/api/admin/*`, `/api/settings/admin/*`, `POST /api/attendance/day/aggregate/refresh`. The web shows the staff selector for `canActForOthers(user.role)` and admin settings for `isAdminRole(user.role)`, but the server check is the real one.

### Logging

Use `AppLogPort.write({ tenantId, level, action, actorStaffId, targetStaffId, details, ...actor.meta })` (`core/ports/appLog.ts`, stored in the monthly-partitioned, append-only `app_logs`; `meta` carries ip, user agent and the request id). Levels `INFO | WARN | ERROR | SECURITY`. Rules (same as GAS `logToBuffer`): always log WARN/ERROR/denials and all writes; log read successes only when they cost money (Maps calls) or when an admin reads another staff's data (`targetStaffId`). Action names are dotted (`report.daily.saved`, `schedule.route.failed`). The port never throws. Process logs are one-line JSON for Cloud Logging: the API logs every request (`http/requestLog.ts`; request id = Cloud Trace id from `X-Cloud-Trace-Context` or a UUID, returned as `X-Request-Id`).

### API contracts and errors

- Request/response shapes are zod schemas in `packages/shared/src/contracts/` (queries too). The API validates input with `parseJsonBody` / `parseQuery` and returns success bodies through `jsonOk(c, schema, body)` (serialized, then parsed by the response schema — a mismatch is a 500 in the log, not a silent drift) (`api/src/http/responses.ts`); the web validates every response against the same schema in `web/src/api/client.ts`. A new endpoint needs a contract first; don't define request schemas locally in routes.
- Usecases throw `DomainError(code, message, fields?, reason?)` (`core/domain/errors/domainError.ts`); `app.onError(onApiError)` maps it once (`DOMAIN_ERROR_STATUS`): `not_found` 404, `forbidden` 403, `validation_failed` 400, `locked` 400, `conflict` 409, `rate_limited` 429, `upstream_unavailable` 502. Anything else is logged with the request id and returned as a generic `internal` 500. Errors are always `{ code, message, fields? }`; `message` is user-facing Japanese; the web shows it via `userMessageOf`. External-service failures return a generic message (details only in logs).
- Endpoint specs: `doc/api/*.md` — update them with behavior changes.

### Attendance (出勤簿) column letters

The DB stores entities (`attendance_days` container + `visits` / `work_segments` / `travel_legs`), not sheet rows. `rowData` (keys are the spreadsheet column letters `C` … `AO`) is a projection that exists only in `packages/core/src/domain/attendance/sheetLayout.ts`: `projectDay(sheet)` → full 25-column `rowData` + `changedFields` + `hiddenVisitCount` (visits `seq` 1–3 fill the sheet slots; 4+ are stored but not shown, with a WARN), and `applyRowEdit(sheet, patch, { source })` → validated entity changes (times `HH:mm`, distances 2 decimals, `overridden_fields` for user edits, overlapping visits → 400). The UI-side mapping is `packages/web/src/features/attendance/model/dayRecord.ts`. Everything else uses the named definitions (`VISIT_SLOTS`, `MOVE_LEGS`, `SLOT_DEFS`…); don't write column letters anywhere else, and keep `gasParity.test.ts` green. Writes are diffs (delete → update → insert) with `entity_changes` holding encrypted before-values. Month lock: only the current month (tenant timezone) is editable (`monthLock.ts`); calendar sync is exempt, as in GAS; `attendance_periods.status='locked'` is enforced by a DB trigger (`KH001`).

### Schedule / route provider

`SCHEDULE_PROVIDER` = `google` (Calendar API + Geocoding/Routes API, `integrations/src/google-schedule`) | `gas_bridge` (delegate to the GAS Web App) | `noop` (always empty). If unset it is inferred from credentials (`integrations/src/schedule-provider/scheduleProvider.ts`); production requires it explicitly. Screen reads may use the 2-hour in-process route cache; **anything written to official records (calendar→attendance sync, nightly job) must use `getFreshScheduleWithRouteForStaff` / `{ fresh: true }`**, which neither reads nor writes the cache and fails (502) instead of returning partial data when a calendar can't be read. Details: `doc/api/schedule-route.md`.

### Outbox (mirror to GAS sheets, password-reset mail)

PostgreSQL is the source of truth. Writes that GAS-side sheets still need enqueue an `outbox_messages` row **in the same Unit of Work** as the domain write, with a deterministic `dedupe_key` `<topic>:<aggregateId>:<version>` (`core/domain/outbox/dedupeKey.ts`; re-enqueueing the same key is a no-op). Topics: `mirror.attendance_day`, `mirror.attendance_aggregate`, `mirror.care_record`, `mirror.receipt`, `mail.password_reset`. With `MIRROR_TO_GOOGLE_SHEETS=false` the UoW skips mirror topics (`skippedOutboxTopics`) and the worker completes leftover ones without sending — both read the same shared env. The worker (`core/usecases/outboxWorker.ts`) claims one message at a time across tenants with `FOR UPDATE SKIP LOCKED` and a lease (`locked_until`), processes it outside the transaction, re-reads the record, and posts to the GAS `Bridge.js` actions (`integrations/src/gas-bridge/gasBridgeMirrorSenderPort.ts`; without `GAS_BRIDGE_URL` sending is a no-op). Failures back off exponentially (`core/domain/outbox/retryPolicy.ts`) up to the message's `max_attempts` → `dead` (+ ERROR `outbox.message_failed`); `PermanentOutboxError` → `failed`. The Bridge write actions are not deployed on the GAS side yet (`doc/api/attendance-batch.md`).

### Worker jobs

`packages/worker/src/entrypoints/`: `nightlyCalendarSync.ts` (GAS `autoSyncTodayScheduleForAllStaff`, 22:00 JST; each tenant's "today" in its timezone, staff active on that date), `csvImport.ts` (GAS `checkAndImportLatestCsv`, 03:00 JST; Drive via `CUSTOMER_CSV_DRIVE_FOLDERS` or local `CUSTOMER_CSV_LOCAL_DIR/<slug>/Kokyaku_*.csv`; refuses to apply if >20% of customers would disappear → `review_required`), `maintenance.ts` (04:00 JST: app_logs partitions, retention deletes, unreferenced stored files — `core/usecases/maintenance.ts` `RETENTION_DAYS`), `syncBusyBlocks.ts` (free/busy for future matching), `outboxOnce.ts`. Jobs are idempotent, exit 1 on any failure or on `JOB_TIMEOUT_MS` (Cloud Run Jobs retry), stop at the next checkpoint on SIGTERM (`jobs/stopSignal.ts`, forced exit after `WORKER_SHUTDOWN_TIMEOUT_MS`) and close the DB pool; and are scheduled by Cloud Scheduler in production (`infra/gcp/scheduler.tf`); `WORKER_IN_PROCESS_CRON=true` runs them inside the poller locally. The GAS triggers they replace must be disabled on cut-over day (`doc/11` §7).

### Migrations

- The baseline is `0000_baseline.sql` (drizzle-kit output; only the header with `btree_gist` and `app_current_tenant()` is hand-added) and `0001_baseline_custom.sql` (hand-written: `set_updated_at` triggers, EXCLUDE constraints, `ON DELETE SET NULL (col)`, the attendance lock and care-record revision triggers, partitioned `app_logs` + partition functions, `platform.provision_tenant()`, FORCE RLS, per-role GRANTs). `app_logs` is defined outside the drizzle-kit schema (`src/customTables/`).
- Edit `packages/db/src/schema/*.ts`, then `pnpm db:generate` to create the next migration; commit schema + SQL + `drizzle/meta`. `pnpm db:generate` must report "No schema changes" when you're done (CI checks).
- Things drizzle-kit can't express (EXCLUDE, triggers, FORCE RLS and GRANTs for new tables) go in a new hand-written migration (`pnpm --filter @katahimo/db exec drizzle-kit generate --custom --name <name>`).
- **Never edit an applied migration** once there is production data. Migrations run before the new app version deploys, so keep them backward compatible (add column → deploy → drop old column next release).
- `packages/db/src/migrate.ts` requires `MIGRATION_DATABASE_URL` and refuses to run unless the session role is `katahimo_owner`.

### Future admin assignment (matching) app

The schema already holds the matching extension (doc/10): tenant status/timezone/business type, `tenant_features`, `custom_fields`, staff attributes and availability, `staff_busy_blocks`, customer preferences/required attributes, customer×staff affinities, `reservations` / `reservation_assignments` (double booking blocked by an EXCLUDE constraint), `matching_runs`. These have tables only (no repositories/usecases yet). When the admin app is built, add its tables following the same rules (tenant_id + RLS + FORCE, composite FKs, encrypted free text) and keep them consistent with doc/10.

## GAS parity verification

- **Logic parity tests** run the legacy GAS source itself in `node:vm` with fake GAS services and compare outputs with the TypeScript port: `packages/core/src/domain/attendance/gasParity.test.ts` (seeded random inputs through `testSupport/gasLegacy.ts`) and `packages/integrations/src/google-schedule/gasParity.test.ts` (`RouteSearch.js` scenarios). They are skipped if the submodule is missing, so run `git submodule update --init` before trusting a green run. When porting more GAS logic, add a parity test in the same style rather than eyeballing.
- **UI parity**: `tools/gas-preview` serves the GAS `index.html` with a mocked `google.script.run` and screenshots it next to the new app (Vite dev server with mocked `/api`) at 390×844, same fixtures, clock fixed at 2026-09-25 10:00 JST. Run `pnpm --filter @katahimo/gas-preview shoot` (starts Vite itself; `--web-url` to reuse a running server; `--only '<regex>'`, `--max-diff` default 0.05 — exits 1 on any shot above it; `--concurrency`). `e2e` likewise starts Vite and the API if needed. Output in `tools/gas-preview/out/` (gitignored); every shot should stay ≤ 0.05% diff. New screens get shots in `src/shots/<feature>.ts` plus mocks in `gasMock.ts` / `webMock.ts` (web mocks are validated against the zod contracts). Known deliberate differences are listed in the READMEs.
- **Live journey**: `pnpm --filter @katahimo/gas-preview e2e` (seeded DB; starts the API and Vite if they aren't running) drives login → schedule → customers → report/receipts → attendance → settings → logout, then a non-admin checks hidden admin UI and 403s. Screenshots in `out/e2e/`. It writes to the DB — dev only.
- Chromium is preinstalled at `/opt/pw-browsers` and `playwright-core` is pinned to 1.56 to match; never run `playwright install`.

## Porting rules

- **Submodule**: `legacy/gas-childcare-visit-app` is read-only. Never edit it here; fixes go to `katahimo-dev/gas-childcare-visit-app`, then `git submodule update --remote legacy/gas-childcare-visit-app` and commit the pointer bump. The GAS app source is in `legacy/gas-childcare-visit-app/gas-childcare-visit-app/`; its `CLAUDE.md` has the file map and caching layers.
- **Clean code over GAS-isms**: reproduce GAS *behavior* (UI classes and exact Japanese wording, outputs, validation messages, edge cases), not its *implementation*. No `innerHTML` string building (JSX), no identity by staff/customer name or sheet row number (use IDs), no column letters outside the layout layer, no client-trusted identity, no whole-sheet rewrites (diff-apply), no hidden global state. Put logic in pure `core/domain` functions with tests, I/O behind ports. When GAS has a bug, fix it and document the deliberate difference (web README / doc/api / gas-preview README) instead of copying it.
- UI work follows `packages/web/README.md` (GAS class names verbatim, Tailwind v3 default theme, `FadeModal`, `showToast`, `STORAGE_KEYS` for every localStorage key, `AdminTargetStaffSelect` + `requestStaffId` for admin targeting, TanStack Query keys under `queryKeys.customers.all` for customer data).
- Secrets only via env / Secret Manager. Production (`NODE_ENV=production`) refuses to start without `KMS_PROVIDER=gcp`, `STORAGE_PROVIDER=gcs`, explicit `SCHEDULE_PROVIDER`, a 32+ char `SESSION_SECRET` (API), and `SMTP_HOST` (worker — password-reset mail is enqueued to the outbox by the API and sent by the worker, so the outbox poller must run in production).
- Record user-visible or operational changes in `CHANGELOG.md` (`## [Ver. x.y.z] - date`, Japanese).

## References

- `doc/07`–`doc/08`: design documents inherited from the earlier prototype (tech stack, multi-tenancy). `doc/09`: current DB schema (ER, roles, encryption, outbox, retention). `doc/10`: matching extension schema. `doc/11`: GCP deployment and GAS cut-over checklist. `doc/api/*.md`: API specs. (`doc/reference/` no longer exists.)
- The earlier prototype (`katahimo-dev/C001-cutest-internal`, `01_GAS/katahimo-app`) was imported as this repo's base; its UI was discarded and rebuilt from the GAS app.
- `ohru131/katahimo-app` (public): demo version, UI/design reference only.
