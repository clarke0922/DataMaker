# DataMaker

[Chinese README](README.zh-CN.md)

DataMaker is a local-first metadata management desktop application built with Electron, React, TypeScript, Node.js, and SQLite.

English is the default language for the application, source code, documentation, and commit messages. The desktop UI can be switched to Simplified Chinese from the language selector in the header.

## Current Features

- Secure Electron window with a sandboxed, allowlisted preload API
- Shared Node.js application services exposed through IPC and loopback-only Fastify APIs
- SQLite via `node:sqlite`, with WAL, foreign keys, FTS5, and an initial normalized schema
- Seven built-in metadata quality rule types with background execution and cancellation
- Metadata browsing, annotations, tags, saved queries, and FTS5 full-text search
- Physical, inferred, and manually confirmed relationship management
- CRUD management for weights, flat and tree dictionaries, factors, public/private tables, daily counts, data cubes, and table categories
- Local user, role, and permission management with enforced RBAC sessions and Argon2id password hashing
- Password complexity enforcement and a fifteen-minute login lock after five consecutive failures
- SQL and SQLite metadata collection with encoding detection, diff preview, and recoverable background jobs
- Excel worksheet metadata import with normalized table names and row counts
- Primary keys, foreign keys, indexes, tags, comments, and field mappings in the exported dictionary
- Cancellable background Markdown dictionary exports, bounded audit logs, manual backup/restore, the five most recent automatic backups, pre-migration snapshots, and post-restore search-index recovery
- Packaged builds can check GitHub Releases, download updates with progress feedback, and install after explicit confirmation
- English and Simplified Chinese UI locales, with English as the default

The reverse-engineered legacy documentation is currently available in Chinese:

- [Detailed Design (Chinese)](project-detailed-design.zh-CN.md)
- [Legacy Data Dictionary (Chinese)](project-data-dictionary.zh-CN.md)

## Local Development

Requirements: Node.js 22 or later and pnpm 11 or later.

```bash
pnpm install
pnpm build
pnpm --filter @datamaker/desktop start
```

Create an unpacked application or platform installer with `pnpm run package:dir`, `pnpm dist:win`, or `pnpm dist:mac`. Windows signing uses electron-builder's standard `CSC_LINK`/`CSC_KEY_PASSWORD` variables. macOS signing and notarization use the corresponding Apple identity and notarization environment variables; Hardened Runtime is enabled by default.

If Windows PowerShell blocks `pnpm.ps1`, use `pnpm.cmd` instead.

## Validation

```bash
pnpm typecheck
pnpm test
pnpm build
```

To verify a legacy metadata SQL export against the expected 87-table/634-field
baseline and its convertible `META_TABLE`/`META_COLUMN` records:

```bash
pnpm verify:legacy -- /path/to/meta.sql
```

The verifier uses a temporary database, never modifies the input file, and
reports initialization rows that are intentionally retained for migration
reporting instead of silently importing unsupported legacy modules.

Run the 100,000-field pagination and FTS interaction check with:

```bash
pnpm verify:scale
```

The application database is stored under Electron's `app.getPath('userData')` directory. External SQLite sources are opened read-only during metadata imports. The local automation API writes its random port, 15-minute temporary token, and expiry to the permission-restricted `local-api.json` file in the same directory and removes it during shutdown.

## Contribution Language

Write source code, code comments, branch names, commit messages, PR titles, and the default documentation in English. Add localized documentation with an explicit locale suffix such as `.zh-CN.md`. See [CONTRIBUTING.md](CONTRIBUTING.md).
