# Open Collective

Transparent fundraising platform. Each subfolder is its own git repo - run git commands there. Per-service conventions live in `<repo>/AGENTS.md`; read that file before changing the service.

**Docs:** https://documentation.opencollective.com
**Security policy:** [SECURITY.md](https://github.com/opencollective/opencollective/blob/main/SECURITY.md)

**Terms:**

- Orders = Contributions (frontend)
- Collectives = Accounts (GraphQL; prefer "Account")

## Services

Services talk via GraphQL. After API schema changes, update consumer copies with `npm run graphql:update` (API must be running) or `./scripts/update-gql.sh`. If unsure, ask the user to update schemas.

- **opencollective-frontend** - Next.js/React UI
- **opencollective-api** - GraphQL API (business logic and persistence)
- **opencollective-rest** - REST wrapper over the GraphQL API
- **opencollective-pdf** - PDF generation (receipts, invoices, reports)
- **opencollective-taxes** - Tax/VAT calculation library
- **opencollective-images** - Image upload, processing, and optimization
- **opencollective-documentation** - Public user docs (GitBook)

Ignore unless asked: `opencollective-tools`, `opencollective-studies`, `opencollective-rss`, `opencollective-github-actions-monitor`.

**Infra:** Docker Compose; Heroku staging/prod; GitHub Actions; Postgres 14+, Redis; S3 prod / MinIO local; Mailpit local; OpenSearch; Sentry/OpenTelemetry/Hyperwatch.

## Development

**Commits:** [Conventional Commits](https://www.conventionalcommits.org/) (`feat`, `fix`, `chore`, `docs`, …). Short title with user-visible impact (`fix(search): crash when searching with special characters`). Then a blank line, `Fixes #123` or a URL, and an optional short body. Optional `npm run commit` (commitizen) after `git add`. Use hyphens, not em dashes.

**Quality:** From the repo subfolder, run that repo's TypeScript, ESLint, and Prettier scripts (see its `AGENTS.md`). Must pass before handoff. Repeat in every touched repo.

**Tests:** `./scripts/test.sh <file>` (`--watch` supported). Auto-detects the runner.

**Manual:** `./scripts/run.sh` then http://localhost:3000 as `testuser+admin@opencollective.com` (no password).

**DB:** `psql postgres://opencollective@postgres/opencollective_dvl` (dev), `.../opencollective_test` (test).

## Security

Triage: `.agents/skills/security-investigate-issue` (internal), `security-investigate-report` (incoming), shared `_shared.md`. Known-safe patterns: `.agents/skills/review-feature-security`. **Not defects:** public GraphQL introspection, permissive API CORS.

OWASP cheat sheets: https://cheatsheetseries.owasp.org/cheatsheets/ (or Context7 `/owasp/cheatsheetseries`). Pick by service and vuln class, not the index. Framing: `Secure_Code_Review` (does not replace skill outputs: `reply.md`, `issue.md` / `plan.md` / `impact.md`, PoC). GraphQL → `GraphQL`. REST → `REST_Security`. OAuth/tokens → `OAuth2`. Sessions/JWT/Passport → `Session_Management`, `Authentication`. Permissions/IDOR/private accounts → `Authorization`, `Access_Control`, `Insecure_Direct_Object_Reference_Prevention`. SQL → `SQL_Injection_Prevention`. Frontend → `Cross_Site_Scripting_Prevention`, `Cross-Site_Request_Forgery_Prevention`. Images → `File_Upload`. SSRF/webhooks → `Server_Side_Request_Forgery_Prevention`. Payments/expenses/ledger → `Business_Logic_Security`, `Third_Party_Payment_Gateway_Integration`. 2FA → `Multifactor_Authentication`. Node/Express → `Nodejs_Security`.
