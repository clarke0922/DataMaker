# Contributing to DataMaker

## Project Language

English is the canonical project language.

- Write source code identifiers and comments in English.
- Write branch names, commit messages, PR titles, and PR descriptions in English.
- Write the canonical README and new technical documentation in English.
- Put translations in locale-specific files such as `README.zh-CN.md`.
- Add user-facing UI copy through the locale layer. Do not embed translated UI text directly in components.
- Keep persisted enum values, API fields, error codes, and diagnostic messages language-neutral or English.

Use concise imperative commit messages, for example:

```text
Add bilingual metadata management UI
Fix sandboxed preload module format
```

Do not rewrite published Git history only to translate older commit messages. Apply this convention to all new commits.

## Validation

Before opening or merging a pull request, run:

```bash
pnpm typecheck
pnpm test
pnpm build
```
