# DataMaker

[Chinese README](README.zh-CN.md)

DataMaker is a local-first metadata management desktop application built with Electron, React, TypeScript, Node.js, and SQLite.

English is the default language for the application, source code, documentation, and commit messages. The desktop UI can be switched to Simplified Chinese from the language selector in the header.

## Current Features

- Secure Electron window with a sandboxed, allowlisted preload API
- Shared Node.js application services exposed through IPC and loopback-only Fastify APIs
- SQLite via `node:sqlite`, with WAL, foreign keys, FTS5, and an initial normalized schema
- Six built-in metadata quality rule types
- Metadata statistics and full-text search dashboard
- CRUD management for weights, flat and tree dictionaries, factors, public/private tables, daily counts, data cubes, and table categories
- SQL and SQLite metadata import with traceable import jobs
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

If Windows PowerShell blocks `pnpm.ps1`, use `pnpm.cmd` instead.

## Validation

```bash
pnpm typecheck
pnpm test
pnpm build
```

The application database is stored under Electron's `app.getPath('userData')` directory. External SQLite sources are opened read-only during metadata imports.

## Contribution Language

Write source code, code comments, branch names, commit messages, PR titles, and the default documentation in English. Add localized documentation with an explicit locale suffix such as `.zh-CN.md`. See [CONTRIBUTING.md](CONTRIBUTING.md).
