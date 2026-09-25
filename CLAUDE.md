# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

`katahimo-app` is the from-scratch rebuild (started 2026-09-25) of the childcare home-visit staff webapp as a proper web application, replacing the Google Apps Script app `gas-childcare-visit-app`. No application code exists yet; the tech stack is to be decided. Code comments, README/CHANGELOG entries, and commit messages are written in **Japanese** — keep new ones in Japanese too.

## References

- **`legacy/gas-childcare-visit-app`** — git submodule of `katahimo-dev/gas-childcare-visit-app`, the live, feature-frozen GAS app. It is the source of truth for behavior (screens, business logic, which spreadsheets/Drive folders are read and written). Run `git submodule update --init` if it is empty. It is a **read-only reference**: never edit files inside it from this repo; GAS fixes go to that repository, then get pulled in with `git submodule update --remote legacy/gas-childcare-visit-app` and committed as a pointer bump. The app's source lives at `legacy/gas-childcare-visit-app/gas-childcare-visit-app/`; read that repo's `CLAUDE.md` for its file map, the admin-vs-self security pattern (never trust a client-supplied staff name), and the caching layers before porting a feature.
- **`doc/reference/`** — design documents from the earlier prototype (TypeScript + Hono + Drizzle + PostgreSQL, multi-tenant) that lived at `katahimo-dev/C001-cutest-internal`'s `01_GAS/katahimo-app`. Treat them as input to design decisions, not as settled decisions. Paths in them (e.g. `01_GAS/gas-childcare-visit-app`) refer to the old monorepo layout. The prototype's code is only in C001-cutest-internal's git history (before the 2026-09-25 move commit).
- **`ohru131/katahimo-app`** (public) — demo version, a UI/design reference.
