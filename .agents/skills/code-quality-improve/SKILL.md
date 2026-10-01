---
name: code-quality-improve
description: Improves code quality across Open Collective services. Use when asked to clean up, refactor, simplify, reduce duplication, or fix code smells; finds smelly code and proposes an improvement plan when no specific scope is given.
---

# Code Quality Improve

Find smelly code and propose a concrete improvement plan. Default output is a plan, not edits.

Read this skill fully before starting.

## Modes

- **Scoped:** user names files, directories, a feature, or specific instructions. Limit discovery to that scope and follow their instructions.
- **Default (no specific instructions):** discover smelly code in the working scope (current diff, worktree, named repo, or current directory) and propose a plan. Do not refactor without being asked.

## Workflow

Copy this checklist and track progress:

```
Task progress:
- [ ] 1. Resolve scope
- [ ] 2. Baseline
- [ ] 3. Find smells
- [ ] 4. Propose plan
- [ ] 5. Implement (only if asked)
```

### 1. Resolve scope

- If the user gave paths, a feature, or instructions, use exactly that scope.
- Otherwise define a bounded scope and state it: e.g. current git diff, current worktree changes, one directory, or one repo. Do not scan the whole monorepo unasked.
- Read the relevant `<repo>/AGENTS.md` before touching code. Respect service boundaries: new platform logic belongs in `opencollective-api`, not `opencollective-rest`.

### 2. Baseline

- Read the in-scope files. Check git status/diff for what changed recently.
- Note existing tests that cover the scope (see `review-feature-tests` skill for discovery).
- Run cheap read-only checks from the repo subfolder when useful: type check, lint, prettier, `ts-unused-exports`. See Quality table below. Do not fix unrelated failures silently; record them.

### 3. Find smells

Look for evidence-backed smells, not style preferences. Confirm each with a file reference (`path:line`):

- **Size/complexity:** long functions/files, deep nesting, complex conditionals, boolean flag params, duplicated branches.
- **Duplication:** copy-pasted logic, parallel helpers that should share one util, repeated GraphQL fragments or queries.
- **Dead code:** unused exports/vars, unreachable branches, commented-out blocks, obsolete TODOs.
- **Typing:** `any`, unsafe casts, `@ts-ignore` / `@ts-expect-error` without justification, missing narrowing.
- **Suppressed checks:** `eslint-disable`, `prettier-ignore`, skipped tests without a reason or issue link.
- **Data/API:** N+1 queries, missing pagination/limits, over-fetching, Sequelize used where Kysely fits an existing complex join (read-only observation; do not migrate unless asked).
- **Frontend:** new styled-components/Styled Icons usage (prefer Tailwind/ShadCN and Lucide), prop drilling that a small composition or hook would fix, duplicated i18n strings (check with `search-i18n-translations` skill).
- **API resolvers:** new/changed V2 resolvers missing the four checks in `opencollective-api/AGENTS.md` (permissions, private accounts, 2FA, OAuth scopes). Report as correctness, not just smell.
- **Tests:** brittle mocks, missing error-path coverage, oversized fixtures.

Ignore: public GraphQL introspection, permissive API CORS (intentional per `AGENTS.md`).

### 4. Propose plan

Always produce a plan, even in default mode. Prioritize:

1. **High:** duplication or complexity that causes bugs, blocks changes, or hurts performance.
2. **Medium:** dead code, weak typing, suppressed checks, test brittleness.
3. **Low:** cosmetic consistency, minor simplifications.

For each item:

- **Location:** `file:line` and function/name.
- **Smell:** one line, with evidence.
- **Proposal:** smallest behavior-preserving change (extract function, collapse conditional, dedupe helper, tighten types, remove dead code).
- **Risk/effort:** Low / Medium / High plus affected tests to run.
- **Do-not-do:** behavior changes, JS-to-TS conversions, Sequelize-to-Kysely migrations, or cross-repo refactors unless the user asked.

Present as a short table followed by a suggested order. Ask which items to implement if the request did not authorize edits.

### 5. Implement (only if asked)

- Implement only approved items. Keep diffs minimal and behavior-preserving.
- Follow per-repo rules: no JS-to-TS conversion unless asked; no Sequelize-to-Kysely migration unless asked; reuse existing i18n strings; new UI uses Tailwind/ShadCN and Lucide.
- After edits, from each touched repo run its TypeScript, ESLint, and Prettier scripts (see table) plus targeted tests via `./scripts/test.sh <file>` from workspace root. Report what passed/failed.

## Quality reference

| Project | Type | Lint | Prettier | Tests |
| --- | --- | --- | --- | --- |
| opencollective-api | `npm run type:check` | `npm run lint:check` | `npm run prettier:check` (fix: `prettier:write`) | Mocha (`npm run test`) |
| opencollective-frontend | `npm run type:check` | `npm run lint:quiet` | `npm run prettier:check` (fix: `prettier:write`) | Jest (`npm run test`), Cypress E2E |
| opencollective-rest | `npm run type:check` | `npm run lint:quiet` | `npm run prettier:check` (fix: `prettier:write`) | Jest (`npm run test`) |
| opencollective-pdf | `npm run type:check` | `npm run lint` | `npm run prettier:check` (fix: `npm run prettier`) | Vitest (`npm run test`) |
| opencollective-images | none | `npm run lint:quiet` | `npm run prettier:check` (fix: `prettier:write`) | `npm run test` |

Run quality scripts from the repo subfolder. Run tests with `./scripts/test.sh <file>` from workspace root.

## Output

- **Scoped request without implement instruction:** findings table + prioritized plan, no code edits.
- **Default (no scope):** scope statement + findings table + prioritized plan, no code edits.
- **Implement requested:** plan + diff summary + quality/test results.

Keep findings source-grounded. If no supported smell is found in scope, say so and do not invent items.
