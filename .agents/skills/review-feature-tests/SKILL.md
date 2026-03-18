---
name: review-feature-tests
disable-model-invocation: true
description: Reviews the test coverage of a feature in Open Collective and proposes a plan to improve coverage when needed. Use when asked to review tests for a feature, assess test coverage, find coverage gaps, or plan new tests. Covers opencollective-frontend (Jest), opencollective-api (Mocha), opencollective-pdf (Vitest), and opencollective-rest (Jest).
---

# Review Feature Tests

## Overview

Analyzes test coverage for a given feature or module, identifies gaps, and produces a prioritized improvement plan. Works across all Open Collective services.

## Workflow

### 1. Identify the Feature and Its Scope

Determine the feature to review. It may be:

- **Path-based**: e.g. `opencollective-api/server/graphql/v2/mutation/ExpenseMutations`
- **Keyword-based**: e.g. "expense approval", "virtual cards", "host dashboard"
- **Component-based**: e.g. `opencollective-frontend/components/edit-collective/sections/ReceivingMoney`

Map the feature to the relevant project:

- **opencollective-frontend**: Jest (`components/`, `lib/`, `pages/`), Cypress E2E (`test/cypress/`)
- **opencollective-api**: Mocha (`test/server/`), tests mirror source structure
- **opencollective-pdf**: Vitest
- **opencollective-rest**: Jest

### 2. Discover Related Tests

Use the discovery script to find tests that cover the feature:

```bash
./.agents/skills/review-feature-tests/scripts/list-feature-tests.sh <project> <path-or-keyword>
```

Examples:

- `list-feature-tests.sh opencollective-api server/graphql/v2/mutation/ExpenseMutations`
- `list-feature-tests.sh opencollective-frontend ReceivingMoney`
- `list-feature-tests.sh opencollective-api expense`

Also search manually when needed:

```bash
# API: tests mirror source; ExpenseMutations → test/server/graphql/v2/mutation/ExpenseMutations.test.*
# Frontend: *.test.tsx alongside components or in __tests__
grep -r "keyword" opencollective-api/test --include="*.test.*" -l
```

### 3. Run Tests and Coverage

Use `./scripts/test.sh` for targeted test runs:

```bash
./scripts/test.sh opencollective-api/test/server/graphql/v2/mutation/ExpenseMutations.test.js
./scripts/test.sh opencollective-frontend/components/edit-collective/sections/ReceivingMoney.test.tsx
```

For coverage, run in the project directory:

```bash
cd opencollective-api && npm run test:coverage -- --grep "Expense"
cd opencollective-frontend && npm run test:coverage -- components/edit-collective
```

Or use the coverage script:

```bash
./.agents/skills/review-feature-tests/scripts/run-feature-coverage.sh <project> [path-filter]
```

### 4. Analyze Coverage Gaps

Read the implementation and test files. Identify:

- **Untested code paths**: Branches, error handlers, edge cases
- **Missing scenarios**: Happy path vs. error paths, permissions, validation
- **Integration gaps**: GraphQL resolvers without loader tests, API without route tests
- **E2E gaps**: Critical flows not covered by Cypress

Use coverage reports (`coverage/lcov-report/index.html` or terminal output) to see line/branch coverage.

### 5. Propose Improvement Plan

Produce a structured plan:

1. **Priority 1 – Critical**: Core business logic, security-sensitive code, payment flows
2. **Priority 2 – Important**: Error handling, validation, permissions
3. **Priority 3 – Nice to have**: Edge cases, refactor safety nets

For each gap:

- **Location**: File and function/path
- **Gap**: What is not tested
- **Suggested test**: Unit, integration, or E2E; describe the scenario
- **Effort**: Low / Medium / High

## Test Frameworks Reference

| Project                 | Framework | Test Dir                  | Pattern                                   |
| ----------------------- | --------- | ------------------------- | ----------------------------------------- |
| opencollective-frontend | Jest      | components/, lib/, pages/ | `*.test.tsx`, `__tests__/`                |
| opencollective-frontend | Cypress   | test/cypress/integration/ | `*.test.js`                               |
| opencollective-api      | Mocha     | test/server/              | Mirrors source, `*.test.ts` or `.test.js` |
| opencollective-pdf      | Vitest    | test/                     | `*.test.ts`                               |
| opencollective-rest     | Jest      | test/                     | `*.test.ts`                               |

## Scripts

### `scripts/list-feature-tests.sh`

Lists test files related to a feature. Run from workspace root.

```bash
./.agents/skills/review-feature-tests/scripts/list-feature-tests.sh <project> <path-or-keyword>
```

### `scripts/run-feature-coverage.sh`

Runs coverage for a project, optionally filtered by path. Run from workspace root.

```bash
./.agents/skills/review-feature-tests/scripts/run-feature-coverage.sh <project> [path-filter]
```
