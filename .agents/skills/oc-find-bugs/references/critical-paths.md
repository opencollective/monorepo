# Critical paths

Where to hunt first when the operator gives no focus. Paths are relative to the service root. Tiers are in priority order; each has a **core** (the default run) and an **extended** set (follow-up runs). Paths move: confirm them with `git ls-files` and use what's there now, keeping the intent of each tier.

## Default run

With no focus, one run takes the **core** of every tier of the target service, in tier order, until the run is full (~30k lines). The next run takes what's left, extended sets in tier order. Tell the operator which tiers and sets the run covers.

## opencollective-api

Skip `migrations/`, `test/`, `scripts/`, `server/graphql/*.graphql` schema dumps, `server/lib/two-factor-authentication/cached-metadata.json`, and other JSON data.

1. **Money movement**: contributions, payment processing, refunds, ledger, fees, currencies, balances.
   - core: `server/lib/payments.ts`, `server/lib/refunds.ts`, `server/models/Transaction.ts`, `server/models/Order.ts`, `server/models/PaymentMethod.ts`, `server/lib/budget.ts`, `server/lib/currency.ts`, `server/lib/math.ts`, `server/paymentProviders/stripe/{webhook,common,creditcard,payment-intent}.ts`, `server/paymentProviders/opencollective/`, `server/lib/security/order.ts`
   - extended: rest of `server/paymentProviders/` (PayPal, Stripe methods, virtual cards), `server/lib/subscriptions.ts`, `server/lib/recurring-contributions.ts`, `server/lib/transactions.ts`, `server/lib/payment-intents/`, `server/graphql/v2/mutation/{Order,PaymentMethod,AddedFunds,Transaction,Stripe,Paypal,VirtualCard}Mutations.ts`, `server/graphql/common/{orders,transactions}.ts`
2. **Authentication and authorization**: sessions, tokens, OAuth, 2FA, scopes, permission helpers.
   - core: `server/middleware/authentication.ts`, `server/lib/auth.ts`, `server/lib/two-factor-authentication/*.ts`, `server/lib/oauth/`, `server/graphql/common/scope-check.ts`, `server/graphql/common/context-permissions.ts`, `server/lib/user-permissions.ts`, `server/controllers/users.ts`
   - extended: `server/models/{User,UserToken,UserTwoFactorMethod,ConnectedAccount}.ts`, `server/graphql/v2/mutation/{Individual,PersonalToken,OAuthAuthorization,Application,ConnectedAccount}Mutations.ts`, `server/controllers/connectedAccounts.ts`, `server/lib/rate-limit.ts`
3. **Expenses**: submission, approval, payment, payout methods, Wise.
   - core: `server/graphql/common/expenses.ts` (largest file: its own slices), `server/models/Expense.ts`, `server/lib/security/expense.ts`
   - extended: `server/graphql/v2/mutation/{Expense,PayoutMethod,Transferwise}Mutations.ts`, `server/lib/transferwise.ts`, `server/paymentProviders/transferwise/`, `server/models/PayoutMethod.ts`
4. **Members and account management**: admins, roles, invitations, hosting, account merges.
   - core: `server/graphql/common/members.ts`, `server/models/Member.ts`, `server/models/MemberInvitation.ts`, `server/lib/account-admins.ts`, `server/graphql/v2/mutation/{Member,MemberInvitation}Mutations.ts`
   - extended: `server/graphql/v2/mutation/{Account,HostApplication}Mutations.ts`, `server/graphql/common/host-applications.ts`, `server/lib/merge-accounts.ts`, `server/lib/hostlib.ts`, `server/lib/collectivelib.ts`

After these: webhooks (`server/controllers/webhooks.ts`, `server/lib/webhooks.ts`), uploaded files, exports, tax forms and KYC, then the rest.

**howToTest:**

> API tests are Mocha + Postgres. Put the test inside your copy of the code under `test/hunt/` and run it from the copy root with `NODE_ENV=test TZ=UTC PG_DATABASE=<your-db> npx mocha --timeout 60000 <file>`. Give yourself a private database first: `createdb -h postgres -U opencollective -T opencollective_test <your-db>` (retry a few times if the template is busy) and `dropdb` it when done; never run tests against `opencollective_test` itself, other agents share it. For pure functions, a `npx tsx` script under your folder is faster. External APIs (Stripe, PayPal, Wise) are never called: stub them the way the existing tests under `test/` do.

## opencollective-frontend

Skip `lang/`, `public/`, `**/__generated__/`, `lib/graphql/types/`, tests, Storybook files, and pure styling components.

1. **Money in the UI**: amounts, currencies, fees and tips the user sees and submits.
   - core: `components/contribution-flow/`, `lib/currency-utils.ts`, `lib/math.ts`, `lib/fees.ts`, `lib/payment-method-utils.tsx`, `lib/stripe/`
   - extended: `components/orders/`, `components/recurring-contributions/`, `components/manual-payment-provider/`, `lib/transactions.tsx`
2. **Authentication**: sign-in, tokens, 2FA, OAuth, redirects.
   - core: `lib/auth.ts`, `lib/LoggedInUser.ts`, `lib/two-factor-authentication/`, `components/two-factor-authentication/`, `components/SignIn.tsx`, `components/SignInOrJoinFree.tsx`, `components/oauth/`, `lib/url-helpers.ts`, `pages/api/`
   - extended: `server/` (Express layer: CSP, rate limits, redirects), `lib/apollo-client.ts`, `components/signup/`
3. **Expenses**: forms that build the submitted payload and the pay/approve actions.
   - core: `components/submit-expense/`, `components/expenses/PayExpenseModal.tsx`, `components/expenses/PayoutMethodForm.tsx`, `lib/expense.ts`, `lib/expenses/`
   - extended: rest of `components/expenses/`
4. **Members and admin**: member roles, invitations, host applications.
   - core: `components/MemberInvitationsList.tsx`, `components/ReplyToMemberInvitationCard.tsx`, `components/MemberRoleDescription.ts`, `components/dashboard/sections/{Team,People}.tsx`
   - extended: `components/osc-host-application/`, `components/accept-financial-contributions/`, `lib/policies.ts`

**howToTest:**

> Frontend tests are Jest. Put the test in your copy of the code next to the module (`*.hunt.test.ts(x)`) and run it from the copy root with `npx jest <file>`. Prefer pure-function tests; for components use React Testing Library the way the existing `__tests__` do. The API is not running: mock GraphQL responses.

## Smaller services

`opencollective-pdf`, `opencollective-rest`, `opencollective-images`, `opencollective-taxes`: no tiers; most fit one run. Order slices: money math (amounts, currencies, taxes, totals on receipts and invoices), then token and permission handling, then anything that serves private data, then the rest. Read the service's `AGENTS.md` for its test runner and write `howToTest` in the same shape as above.
