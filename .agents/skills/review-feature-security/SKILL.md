---
name: review-feature-security
disable-model-invocation: true
description: >
  Performs a structured security review of a specific feature, PR, or code change
  in the Open Collective codebase. Use when asked to review the security of a new
  feature, a pull request, or a code change. Covers authentication, authorization,
  input validation, data exposure, business logic, GraphQL safety, file uploads,
  webhooks, cryptography, logging, rate limiting, and frontend security.
---

# Security Review: Feature

## Overview

Conduct a focused security review on a specific feature or code change.

Detailed checks for each security category live in `references/checklist.md`.

---

## Workflow

### 1. Define Scope

Identify the files and components in scope:

- Ask the user for the feature, PR, or files if not already specified..
- Identify which layers are touched: API mutations/queries, REST endpoints, frontend forms, cron jobs, webhooks, payment flows, file uploads.

### 2. Gather Context

Read the relevant files to understand what the feature does:

- What data does it read or write?
- What roles/permissions does it require?
- Does it involve payments, file uploads, webhooks, OAuth, or external integrations?

### 3. Apply the Checklist

Work through `references/checklist.md`, focusing only on sections relevant to the
feature. Prioritize critical checks first (auth → authz → injection → payments).

Use `rg` (ripgrep) to search for dangerous patterns across the in-scope files:

```bash
# Examples
rg "dangerouslySetInnerHTML" opencollective-frontend/
rg "eval\(" opencollective-api/server/
rg 'query\(.*\${' opencollective-api/server/
rg "Math\.random\(\)" opencollective-api/server/lib/
```

### 4. Document Findings

For each finding, create a file using the [Output Format](#output-format) below.
Store under `priv/security-review/:date-:feature` (never commit to git).

### 5. Write Summary

Create `priv/security-review/:date-:feature/SUMMARY.md` with:

- Scope reviewed (feature name, files)
- Finding counts by severity
- Top 3 recommendations

---

## Output Format

```
priv/security-review/:date-:feature
├── critical/   # CVSS 9.0–10.0
├── high/       # CVSS 7.0–8.9
├── medium/     # CVSS 4.0–6.9
├── low/        # CVSS 0.1–3.9
└── SUMMARY.md
```

**Filename:** `{CVSS_SCORE}-{category}-{short-description}.md`
(e.g. `7.5-authz-missing-permission-check-on-expense-mutation.md`)

**Finding template:**

```markdown
# [Title]

**CVSS Score:** X.X ([Severity])
**Category:** [Auth / AuthZ / Injection / Payments / ...]
**Affected Code:** `path/to/file.ts`, lines N–M

## Description

[What is the vulnerability?]

## Impact

[What can an attacker do?]

## Evidence

[Code snippet demonstrating the issue]

## Recommendation

[How to fix it — be specific]

## References

- CWE-XXX: [name]
- OWASP: [Top 10 category or link]
```

### CVSS Severity Table

| Severity | Range    | Typical findings                                             |
| -------- | -------- | ------------------------------------------------------------ |
| Critical | 9.0–10.0 | Auth bypass, RCE, SQLi, payment fraud, credential theft      |
| High     | 7.0–8.9  | IDOR, webhook forgery, privilege escalation, mass assignment |
| Medium   | 4.0–6.9  | Info disclosure, weak rate limits, missing input validation  |
| Low      | 0.1–3.9  | Hardening opportunities, minor config issues                 |

When uncertain, use midpoint: Critical → 9.5, High → 7.5, Medium → 5.5, Low → 2.0.

---

## Known Safe Patterns (Do Not Flag)

Based on prior audits of the Open Collective codebase, the following are **intentional**:

- **GraphQL introspection enabled** — API is public; introspection is on purpose.
- **Permissive CORS** — API is public; CORS is intentionally permissive.
- **Webhook signature verification** — Stripe, PayPal, and Transferwise already verify signatures; `rawBody` is set for `/webhooks` routes in `express.ts`. Idempotency handled via existing transaction lookups.
- **SQL parameterization** — `queries.js`, `sql-search.ts`, and Kysely collection queries already use parameterized queries.
- **Authorization hooks** — `ExpenseMutations`, `OrderMutations`, `PayoutMethodMutations` already perform permission checks; `security/expense.ts` and `security/order.ts` implement fraud checks.
- **GraphQL Armor** — Apollo Armor enforces depth, cost, token, and alias limits globally; rate limiting applies to all GraphQL endpoints.

---

## Checklist Reference

See `references/checklist.md` for detailed, actionable checks organized by category:
authentication, authorization, GraphQL, SQL/DB, input validation, file uploads,
webhooks, payments, frontend, cryptography, rate limiting, logging, and business logic.
