# Security report memory

Long-term index of security findings triaged under `priv/security-issues/`. Each entry lists the reporter, a short title, and the bounty granted (or recommended band when payment is pending). Use **—** when no monetary bounty was awarded.

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
| 2026-04-29 | Transactions import cross-host expense linkage                                 | —      |
| 2026-05-04 | Setup Intent path bypasses `REQUIRE_2FA_FOR_ADMINS`                            | $120   |
| 2026-05-05 | Stale host application hijack                                                  | —      |
| 2026-05-06 | GraphQL v2 `Account.webhooks` leaks webhook URL without admin auth             | $300   |
| 2026-05-11 | PayPal payout method connected account injection                               | $300   |
| 2026-05-21 | `editVendor` bypasses payout-method 2FA gate                                   | $300   |
| 2026-06-02 | Gift card issuer restrictions bypassed via `updateOrder`                       | $120   |
| 2026-06-05 | OAuth application redirect URI can be changed without 2FA                      | $120   |
| 2026-06-05 | Disabled expense type policy bypass via `draftExpenseAndInviteUser`            | —      |
| 2026-06-05 | Stripe webhook duplicate charge race affecting expense payout checks           | $120   |

---

## offsetmd (offsetmd@tuta.com)

| Date       | Title                                                                | Bounty |
| ---------- | -------------------------------------------------------------------- | ------ |
| 2026-06-02 | `editExpense` payee / payout authorization bypass (oc-api-05)        | —      |
| 2026-06-02 | Private account content leak via `Order.fromAccount` nested fields   | $300   |
| 2026-06-02 | PersonalToken query allows co-admin to steal org-scoped token        | $600   |
| 2026-06-02 | GraphQL v1 unauthenticated leak of order tax idNumber and customData | $300   |

---

## Phan Phan Hai Long

| Date       | Title                                                                           | Bounty |
| ---------- | ------------------------------------------------------------------------------- | ------ |
| 2026-04-20 | `editVendor` IDOR leaks payout-method bank details and reroutes vendor expenses | $600   |

---
