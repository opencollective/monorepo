# Security report memory

Long-term index of security findings triaged under `priv/security-issues/`. Each entry lists the reporter, a short title, and the bounty granted (or recommended band when payment is pending). Use **—** when no monetary bounty was awarded.

Maintained by `/security-investigate-issue` and `/security-investigate-report` after each full triage (not on duplicate short path). Internal findings use the **Internal** section.

---

## Angga Pratama (anggadotid.id@gmail.com)

| Date       | Title                                      | Bounty |
| ---------- | ------------------------------------------ | ------ |
| 2026-05-14 | `/proxy/images` SSRF via `isValidUrl` only | —      |

---

## Anil (anildj7662@gmail.com)

| Date       | Title                               | Bounty |
| ---------- | ----------------------------------- | ------ |
| 2026-04-20 | Social media link domain validation | —      |

---

## averagebughunter (avaragebughunter@gmail.com)

| Date       | Title                                                       | Bounty |
| ---------- | ----------------------------------------------------------- | ------ |
| 2026-06-05 | OAuth `email` scope bypass on transaction and receipt reads | —      |

---

## Internal

| Date       | Title                                                                          | Bounty |
| ---------- | ------------------------------------------------------------------------------ | ------ |
| 2026-06-29 | `createConversation` nested Account fields leak private organization data      | —      |

---

## Judel Palaca (jupaloks@gmail.com)

| Date       | Title                                                                          | Bounty |
| ---------- | ------------------------------------------------------------------------------ | ------ |
| 2026-04-20 | `editAddedFunds` accepts non-added-funds orders                                | —      |
| 2026-04-20 | `editExpense` incomplete payout method skips re-review                         | —      |
| 2026-04-20 | `replaceCreditCard` vs `REQUIRE_CLIENT_CONFIRMATION` drift                     | —      |
| 2026-04-21 | Minimum admins host policy bypass via `editMember` / v1 `editCoreContributors` | $120   |
| 2026-04-23 | Deactivate host leaves orphaned child projects able to receive contributions   | —      |
| 2026-04-27 | Child project host redirect via deprecated v1 `editCollective`                 | —      |
| 2026-04-27 | Frozen parent does not block new child project/event creation                  | $120   |
| 2026-04-27 | Session JWT leaked into GitHub OAuth `redirect_uri` via `access_token`         | —      |
| 2026-04-27 | `reorderManualPaymentProviders` cross-host scoping                             | $120   |
| 2026-04-27 | `requestVirtualCard` mutation vs feature flag                                  | —      |
| 2026-04-27 | Collective admin indirectly resuming manually paused virtual card              | —      |
| 2026-04-28 | Stale host can rewire pending cross-host expense payout method after rehost    | —      |
| 2026-04-29 | Transactions import cross-host expense linkage                                 | —      |
| 2026-05-14 | Former host retains virtual-card control over child projects after parent rehost | —      |
| 2026-05-16 | Legacy REST connected-account disconnect bypasses v2 safety checks             | —      |
| 2026-05-04 | Setup Intent path bypasses `REQUIRE_2FA_FOR_ADMINS`                            | $120   |
| 2026-05-05 | Stale host application hijack                                                  | —      |
| 2026-05-06 | GraphQL v2 `Account.webhooks` leaks webhook URL without admin auth             | $300   |
| 2026-05-11 | PayPal payout method connected account injection                               | $300   |
| 2026-05-21 | `editVendor` bypasses payout-method 2FA gate                                   | $120   |
| 2026-06-02 | Gift card issuer restrictions bypassed via `updateOrder`                       | $120   |
| 2026-06-05 | OAuth application redirect URI can be changed without 2FA                      | $120   |
| 2026-06-05 | Disabled expense type policy bypass via `draftExpenseAndInviteUser`            | —      |
| 2026-06-05 | Stripe webhook duplicate charge race affecting expense payout checks           | $120   |
| 2026-06-26 | Locked invited draft PAYEE vs payout method (intentional design)               | —      |
| 2026-06-26 | `updateAccountPlatformSubscription` missing OAuth `account` scope (fixed #11720) | —      |
| 2026-06-26 | `PRIVATE_NOTE` improper access control (host applications + expenses; #195, #198) | $300   |
| 2026-06-26 | OAuth `account` scope escalates to host-wide tax ID export via async worker        | —      |
| 2026-06-26 | `editExpense` payer admin payout edit (legacy permissions; #8308)                     | —      |
| 2026-06-29 | Private org metadata leaked via Account.members / Account.contributors on public collective | —      |

---

## offsetmd (offsetmd@tuta.com)

| Date       | Title                                                                | Bounty |
| ---------- | -------------------------------------------------------------------- | ------ |
| 2026-06-02 | `editExpense` payee / payout authorization bypass (oc-api-05)        | —      |
| 2026-06-02 | Private account content leak via `Order.fromAccount` nested fields   | $300   |
| 2026-06-02 | PersonalToken query allows co-admin to steal org-scoped token        | $600   |
| 2026-06-02 | GraphQL v1 unauthenticated leak of order tax idNumber and customData | $300   |
| 2026-06-08 | Cookie-authenticated REST exports cached as public (CDN cross-user PII leak) | $150 |
| 2026-06-26 | Stripe order `payment_intent.succeeded` missing idempotency lock (not a security issue per team) | — |

---

## Phan Phan Hai Long

| Date       | Title                                                                           | Bounty |
| ---------- | ------------------------------------------------------------------------------- | ------ |
| 2026-04-20 | `editVendor` IDOR leaks payout-method bank details and reroutes vendor expenses | $600   |

---

## Unknown reporter (FMfcgzQgMCgLBfDMfgwNQqDVdhqWGNNs)

| Date       | Title                                                                 | Bounty |
| ---------- | --------------------------------------------------------------------- | ------ |
| 2026-06-26 | Public vendor tax ID disclosure via GraphQL `Account.settings`        | —      |

---
