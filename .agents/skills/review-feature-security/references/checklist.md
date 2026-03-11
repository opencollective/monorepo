# Security Review Checklist

Per-category checks for reviewing features in the Open Collective codebase.
Work through the sections relevant to the feature under review.

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Authorization](#2-authorization)
3. [GraphQL](#3-graphql)
4. [SQL & Database](#4-sql--database)
5. [Input Validation](#5-input-validation)
6. [File Uploads](#6-file-uploads)
7. [Webhooks](#7-webhooks)
8. [Payments](#8-payments)
9. [Frontend](#9-frontend)
10. [Cryptography](#10-cryptography)
11. [Rate Limiting](#11-rate-limiting)
12. [Logging & Error Handling](#12-logging--error-handling)
13. [Business Logic](#13-business-logic)

---

## 1. Authentication

- [ ] Every resolver/mutation/REST endpoint that requires a user reads `req.remoteUser` and rejects if null.
- [ ] `checkRemoteUserCanUseApp()` (or equivalent) is called for operations that require an active user.
- [ ] JWT tokens are not accepted in URL query parameters (leakage in logs, Referer headers, browser history).
- [ ] Personal access tokens check `token.scope` — tokens scoped to `expenses` cannot perform `orders` operations, etc.
- [ ] Session invalidation is triggered when a user changes their password or revokes a token.
- [ ] WebAuthn/2FA flows (if any) do not have a bypass path (e.g., skipping the second factor via a different endpoint).
- [ ] Auth errors return generic messages — do not reveal whether a user exists.

```bash
# Find resolvers that may be missing auth checks
rg "async.*Mutation|async.*Query" opencollective-api/server/graphql/v2/ -l
rg "remoteUser" opencollective-api/server/graphql/v2/mutation/ | grep -v "checkRemoteUser\|if.*remoteUser\|!remoteUser"
```

---

## 2. Authorization

- [ ] Every mutation that touches a resource (expense, order, collective, payout method) verifies the caller owns or administers it — not just that they're authenticated.
- [ ] IDOR check: can a user substitute another user's resource ID to access or modify it?
- [ ] `isAdminOfCollective` / `isAccountAdmin` / role checks cannot be bypassed by providing a different `CollectiveId`.
- [ ] New admin-only fields/mutations are gated on `req.remoteUser.isAdminOfCollective(...)` or `hasRole(...)`.
- [ ] Collective/Account visibility rules (PRIVATE, INCOGNITO) are respected in new queries.
- [ ] Batch operations (e.g., bulk update) check permission for *each* item, not just the first.

```bash
# Look for mutations missing permission guards
rg "async.*Mutation" opencollective-api/server/graphql/v2/mutation/ -A 10 | grep -B5 "await.*Model\."
```

---

## 3. GraphQL

- [ ] New input types do not accept unexpected fields that flow into `create`/`update` calls (mass assignment).
  - Watch for patterns like `Model.create(args)` or `instance.update(args)` where `args` comes directly from GraphQL input.
- [ ] Mutations return only the fields appropriate for the caller's role — internal fields (e.g., `stripeCustomerId`, `twoFactorAuthSecret`) are not exposed.
- [ ] New queries do not create N+1 data-extraction vectors (large paginated queries that can enumerate all records).
- [ ] Resolver errors do not bubble raw Sequelize/DB errors to the client.
- [ ] Sensitive fields (tokens, hashed passwords, internal IDs) are not added to public types.

```bash
# Find direct model creates/updates from GraphQL args
rg "\.create\(args\|\.update\(args\|\.create\(input\|\.update\(input" opencollective-api/server/graphql/
```

---

## 4. SQL & Database

- [ ] No string interpolation into raw SQL: `db.query(\`SELECT ... WHERE id = ${id}\`)` is a red flag.
- [ ] Sequelize `where` clauses use objects or `Op.*` operators — not raw string concatenation.
- [ ] Kysely queries use parameterized bindings (`eb('column', '=', value)`) — not template literals inside `sql\`...\``.
- [ ] Search/filter inputs (user-supplied sort fields, column names) are validated against an allowlist before being interpolated.
- [ ] New migrations use `queryInterface.sequelize.query` with bind parameters, not string interpolation.

```bash
rg 'query\(`[^`]*\${' opencollective-api/server/
rg 'sequelize\.query\(' opencollective-api/server/ -A 3
rg 'sql`[^`]*\${' opencollective-api/server/
```

---

## 5. Input Validation

- [ ] All user-supplied strings are validated for type, length, and format before use.
- [ ] URLs (redirect targets, external links) are validated — reject `javascript:`, `data:`, and off-domain redirects unless explicitly allowed.
- [ ] Slugs, usernames, and identifiers are validated against a strict allowlist pattern (alphanumeric + hyphens only).
- [ ] Email addresses are validated on the backend (not just frontend).
- [ ] Numeric inputs (amounts, quantities) are validated as positive integers/decimals with appropriate bounds.
- [ ] Zod schemas (frontend) mirror server-side validation — the frontend is not the only gate.
- [ ] HTML/Markdown fields that render user content are sanitized (DOMPurify or similar) before rendering.

```bash
rg "redirect|redirectTo|returnTo|next=" opencollective-api/server/ -n
rg "dangerouslySetInnerHTML" opencollective-frontend/ -n
```

---

## 6. File Uploads

- [ ] MIME type is validated server-side (magic bytes / content-type), not just the file extension.
- [ ] File size is limited before the upload is processed.
- [ ] S3 key / file path is generated server-side — user cannot control the destination path (path traversal).
- [ ] Uploaded files are stored in a dedicated S3 prefix/bucket, not alongside application assets.
- [ ] SVG uploads are sanitized (SVG can carry XSS payloads).
- [ ] Download/serve URLs do not allow enumerating other users' files.

```bash
rg "uploadFile\|s3\.upload\|putObject" opencollective-api/server/ -n
rg "mimetype\|mime_type\|contentType" opencollective-api/server/ -n
```

---

## 7. Webhooks

> Note: Stripe, PayPal, and Transferwise signature verification is already in place. Focus on *new* webhook sources.

- [ ] Incoming webhook payload is verified with a signature/HMAC before any processing.
- [ ] `rawBody` is used for signature verification (not parsed JSON — body parsers alter the payload).
- [ ] Idempotency: duplicate webhook deliveries do not cause double-processing (check for existing transaction lookup).
- [ ] Webhook handler does not trust user-supplied amounts or status fields — always fetch the resource from the payment provider's API to confirm.
- [ ] Webhook endpoint is not authenticated by a secret in the query string (easily leaked in logs).

---

## 8. Payments

- [ ] Payment amounts are validated **server-side** — the client cannot pass an arbitrary amount.
- [ ] Currency is validated and consistent throughout the transaction chain.
- [ ] Stripe/PayPal/Wise API responses are checked for errors before marking a transaction as successful.
- [ ] Idempotency keys are used for Stripe charges to prevent double-charging on retries.
- [ ] Refunds/credits cannot be triggered by a user without appropriate authorization.
- [ ] Platform fees and host fees are calculated server-side, not passed from the client.
- [ ] Negative amounts or zero-amount edge cases are explicitly handled (cannot donate $0 or −$1).

```bash
rg "amount.*req\.body\|amount.*args\." opencollective-api/server/ -n
rg "stripe\.charges\.create\|stripe\.paymentIntents\.create" opencollective-api/server/ -A 5
```

---

## 9. Frontend

- [ ] `dangerouslySetInnerHTML` is not used with user-supplied content (XSS).
- [ ] User-generated URLs rendered as `<a href>` are sanitized (`javascript:` URLs blocked).
- [ ] Sensitive data (tokens, session info) is not stored in `localStorage` (prefer `httpOnly` cookies or in-memory).
- [ ] GraphQL queries request only the fields needed — over-fetching exposes more data than necessary.
- [ ] Error messages shown to users do not include stack traces, internal IDs, or SQL errors.
- [ ] Forms use CSRF protection (Next.js API routes with `sameSite` cookie or explicit token).
- [ ] OAuth flows include and validate a `state` parameter.
- [ ] `rel="noopener noreferrer"` on external links with `target="_blank"`.

```bash
rg "dangerouslySetInnerHTML" opencollective-frontend/components/ -n
rg "localStorage\.set" opencollective-frontend/ -n
rg 'href=\{.*user\|href=\{.*input\|href=\{.*url' opencollective-frontend/components/ -n
```

---

## 10. Cryptography

- [ ] `Math.random()` is never used for security-sensitive values (tokens, nonces, OTPs) — use `crypto.randomBytes()`.
- [ ] Secrets/tokens are compared using constant-time comparison (`timingSafeEqual`) to prevent timing attacks.
- [ ] Password hashing uses bcrypt (or equivalent) with a sufficient cost factor — not MD5/SHA1.
- [ ] Sensitive values (API keys, secrets) are loaded from environment variables — not hardcoded.
- [ ] JWTs use strong algorithms (RS256 or HS256 with a long secret) — not `none` or weak algorithms.

```bash
rg "Math\.random\(\)" opencollective-api/server/lib/ -n
rg "createHash\('md5'\)\|createHash\('sha1'\)" opencollective-api/server/ -n
rg "algorithm.*none\|alg.*none" opencollective-api/server/ -n
```

---

## 11. Rate Limiting

- [ ] Expensive or sensitive operations are rate-limited: account creation, password reset, email verification, payment initiation.
- [ ] New GraphQL mutations are not exempted from the existing rate limiter.
- [ ] New REST endpoints apply rate limiting middleware.
- [ ] Brute-force vectors (login, OTP verification) have per-IP and per-account limits.

```bash
rg "rateLimiter\|rateLimit\|limiter" opencollective-api/server/ -l
# Check if new routes include rate-limiting middleware
```

---

## 12. Logging & Error Handling

- [ ] No passwords, tokens, secrets, or PII (SSNs, full card numbers) are written to logs.
- [ ] Error responses to clients are generic — internal details (stack traces, DB errors, file paths) are not exposed.
- [ ] Sentry is capturing errors but the captured data is scrubbed of secrets (check `beforeSend` hooks).
- [ ] New cron jobs and background workers log failures to Sentry/monitoring, not silently swallow errors.
- [ ] Audit-sensitive actions (role changes, payment actions, admin overrides) emit appropriate log entries.

```bash
rg "console\.log.*token\|console\.log.*password\|console\.log.*secret" opencollective-api/server/ -n
rg "res\.json.*stack\|res\.send.*stack" opencollective-api/server/ -n
```

---

## 13. Business Logic

- [ ] State machine transitions are validated server-side (e.g., an expense can only move from PENDING → APPROVED, not REJECTED → PAID directly).
- [ ] Financial calculations cannot produce negative balances unless explicitly allowed.
- [ ] Race conditions in financial operations are mitigated (DB transactions, optimistic locking, or idempotency checks) — especially for concurrent contribution submissions.
- [ ] Collective balance checks happen *inside* a DB transaction so concurrent requests cannot both see sufficient balance.
- [ ] Privilege escalation paths: a user cannot grant themselves admin rights by crafting a specific mutation sequence.
- [ ] Feature flags / plan restrictions cannot be bypassed by calling an endpoint directly.
- [ ] Soft-deleted records (paranoid Sequelize models) are excluded from queries unless intentionally included.

```bash
rg "findOne\|findAll" opencollective-api/server/graphql/v2/ | grep -v "paranoid.*false\|where.*deletedAt"
```
