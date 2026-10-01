---
name: review-feature-security
description: Lists known-safe patterns for Open Collective security reviews. Use with feature reviews and security-audit hunters.
---

# Review Feature Security

Load this skill before filing a security finding. It lists intentional postures that are **not defects**, and the classes that still are. Canonical bounty policy: [SECURITY.md](https://github.com/opencollective/opencollective/blob/main/SECURITY.md). API resolver checklist: `opencollective-api/AGENTS.md`.

Hunters in `security-audit`, `security-audit-api-2fa`, and `security-audit-api-scopes` must apply this list before proposing `confirmed` or opening a Bug.

## Not defects (known-safe)

Do not file these, and do not spend hunt budget proving they are unsafe:

- **Public GraphQL introspection.** Introspection on the public API is intentional.
- **Permissive API CORS.** Permissive CORS on the API is an accepted posture, not a finding by itself.
- **GraphQL V1 OAuth or personal token scopes.** Missing scope checks on `/graphql/v1` are non-qualifying in SECURITY.md. Token-based clients are not allowed to use V1 by default (`application.data.enableGraphqlV1`, `data.allowGraphQLV1`).
- **Session JWT without `userToken` / `personalToken` bypassing OAuth scopes.** Cookie or session JWT callers are not OAuth clients. `rejectOAuthAndPersonalTokenAuth(req)` is the session-only control. That is not an OAuth-scope bypass.
- **`preAuthorize2FA` and `TWO_FACTOR_SESSIONS_PARAMS`.** Token `preAuthorize2FA` and short session params (for example `MANAGE_PERSONAL_TOKENS` at five minutes) are intentional short 2FA sessions. They are not a bypass by themselves.
- **`onlyAskOnLogin`.** When the threat model is login-time 2FA only, `validateRequest` / `enforceForAccount` with `onlyAskOnLogin: true` is intentional. Defense-in-depth ("ask again after login") is hardening, not a Bug.
- **Guest or public mutations with a documented ESLint opt-out** `graphql-mutations/require-scope-check` plus a comment explaining why the field is public or guest. The opt-out is not a missing-scope finding.

Also treat SECURITY.md non-qualifying items (self-XSS, missing headers, rate limiting without a boundary result, scanner-only reports, hypothetical best practice) as out of scope for Bug filing.

## Defect classes (file these when evidence holds)

A finding still needs a real trust-boundary result. These are in scope:

- **Missing 2FA on admin-write** that must follow host `REQUIRE_2FA_FOR_ADMINS` (`twoFactorAuthLib.enforceForAccount` / `enforceForAccountsUserIsAdminOf` / `validateRequest`). Same class as `editVendor` payout-method changes.
- **Wrong or missing OAuth scope on GraphQL V2** queries, mutations, or nested fields. The defect is the actual enforced scope set, not that ESLint saw some helper. Weaker or unrelated scopes, incomplete multi-scope checks, and schema `Scope:` drift count.
- **IDOR and private-organization leaks** (`assertCanSeeAccount` / `canSeePrivateAccount` and collection filters).
- **Payout and ledger integrity** (expense retargeting, order locks, payment-method rebinding, transaction historicity).
- **Webhook SSRF** and other server-side request forgery on outbound fetches.
- Qualifying classes in SECURITY.md that are actually reachable: RCE, injection, XSS, CSRF with real impact, auth bypass, privilege escalation.

## How to use during feature review

1. Identify the service and entry (usually a V2 mutation or field).
2. Check permissions, private accounts, 2FA, and V2 scopes per `opencollective-api/AGENTS.md`.
3. Drop any candidate that matches **Not defects**.
4. For a remaining candidate, name principal, intended control, crossed boundary, and result before calling it a defect.
