# Open Collective Architecture & Technical Stacks

## Overview

Open Collective is a platform for transparent fundraising and financial management for open source projects and communities. The platform is built with multiple specialized services communicating via GraphQL and REST APIs.

## Architecture

The **opencollective-frontend** (Next.js/React web application) serves as the primary user interface. It communicates with backend services via GraphQL and REST APIs. The frontend connects to multiple backend services:

- **opencollective-api**: The main GraphQL API service that handles business logic and data persistence. This is the primary backend service.
- **opencollective-rest**: A REST API service that wraps the GraphQL API for legacy integrations.
- **opencollective-pdf**: A dedicated service for PDF document generation.
- **opencollective-images**: A service for image processing and optimization.

Each subfolder is a separate repository. Whenever running git commands, make sure to run them from the relevant subfolders.

## General Concepts

- Orders: generally called "Contributions" in the frontend.
- Collectives: exposed as "Accounts" by the GraphQL API, we tend to increasingly use the word "Account" everywhere.

## Core Services

Services communicate primarily via GraphQL. Most services hold a local copy of the GraphQL schema. Whenever changes happen in the GraphQL API,
you must remember to update the local schema files in the services (usually with `npm run graphql:update`). The API must be running for this to work.
When in doubt, pause and ask user to manually update the schema files.

### 1. **opencollective-api** (Main Backend API)

The primary GraphQL API service that handles all business logic, data persistence, and integrations.

**Tech Stack:**

- **Base**: Node.js / Express / TypeScript with Babel for transpilation
- **API**: GraphQL (Apollo Server) with two schema versions: V1 (legacy) and V2 (modern)
- **ORM**: Sequelize + Kysely
- **Database**: PostgreSQL
- **Session Management**: Redis (connect-redis)
- **Authentication**: Passport.js, JWT, WebAuthn
- **Payment/Payout Providers**: Stripe, PayPal, Wise, Manual
- **Email**: Nodemailer with Handlebars templates
- **File Storage**: AWS S3 (or MinIO for local dev)
- **Search**: OpenSearch (in private alpha state, production is still using Postgres full text search)
- **Monitoring**: Sentry, Hyperwatch
- **Security**: Helmet, GraphQL Armor
- **Testing**: Mocha, Sinon, Chai
- **CRON Jobs**: Using Heroku scheduler on the `cron` directory.

**Rules for fetching data in the database:**

- Do not try to understand the schema by looking at the migrations, there are too many. Look at the models instead.
- Use sequelize for simple queries.
- When complex joins and composition are needed, use kysely.
- Unless specified, avoid migrating existing queries from raw/sequelize to kysely.

**Additional instructions:**

- All new files (including migrations and tests) should use Typescript.
- Unless specified, avoid migrating existing files from Javascript to Typescript.
- Unversioned `/graphql` serves V2; V1 is `/graphql/v1`.
- OAuth tokens and personal tokens are rejected on V1 unless allow-listed (`application.data.enableGraphqlV1` on the app, `data.allowGraphQLV1` on the token); see `opencollective-api/server/routes.ts`.

**Zero-decimal currencies (JPY, KRW, etc.):**

All monetary amounts in the database are stored multiplied by 100, regardless of currency — including zero-decimal currencies. So ¥15 is stored as `1500`, exactly like $15.00. The list of zero-decimal currencies is in `server/constants/currencies.ts` (`ZERO_DECIMAL_CURRENCIES`).

**PayPal recurring subscriptions (managed externally):** For subscriptions with `Subscription.isManagedExternally` and a `paypalSubscriptionId`, `Orders.totalAmount` must match the amount on the PayPal billing plan (`plan_id` / `PaypalPlans`). PayPal is the source of truth for what is charged. The GraphQL `updateOrder` mutation requires a new `paypalSubscriptionId` after the contributor completes PayPal’s approval flow when changing amount or tier; applying amount or tier changes without that flow would desynchronize the database from PayPal. To audit drift, run [`scripts/paypal/check-subscriptions-amounts.ts`](opencollective-api/scripts/paypal/check-subscriptions-amounts.ts) (defaults to subscriptions updated in the last 7 days; override with `PAYPAL_SUBSCRIPTION_AMOUNT_CHECK_LOOKBACK_DAYS` or `--lookback-days`).

### 2. **opencollective-frontend** (Main Web Application)

The user-facing web application built with Next.js and React.

**Tech Stack:**

- **Base**: Next.js / React / TypeScript
- **Styling**:
  - Tailwind CSS with ShadCN (primary, utility-first)
  - Styled Components / Styled System (legacy, being migrated to tailwind)
- **Icons**: Lucide React (mostly), Styled Icons (legacy)
- **State Management**: Apollo Client (GraphQL)
- **Forms**: Formik, Zod for validations. FormikZod is a wrapper around Formik that plugs in Zod validation.
- **Internationalization**: React Intl
- **Charts**: ApexCharts
- **Animations**: Framer Motion
- **Testing**: Jest, React Testing Library, Cypress (E2E)

**Tips**

- Search existing translations: See .agents/skills/search-i18n-translations/SKILL.md

### 3. **opencollective-rest** (REST API Service)

A REST API wrapper around the GraphQL API for legacy integrations and simpler HTTP endpoints.

**Tech Stack:**

- **Runtime**: Node.js
- **Framework**: Express
- **Language**: TypeScript
- **GraphQL Client**: Apollo Client (queries main GraphQL API)
- **Build**: Babel

### 4. **opencollective-pdf** (PDF Generation Service)

A microservice dedicated to generating PDF documents (receipts, invoices, reports).

**Tech Stack:**

- **Runtime**: Node.js
- **Framework**: Express
- **Language**: TypeScript (ES modules)
- **PDF Generation**: React PDF (@react-pdf/renderer)
- **Testing**: Vitest
- **GraphQL Client**: Apollo Client

### 5. **opencollective-taxes** (Tax Calculation Library)

A shared library for calculating taxes, VAT, and related financial computations.

**Tech Stack:**

- **Language**: TypeScript
- **Libraries**:
  - jsvat-next (VAT validation)
  - sales-tax (tax calculations)
- **Testing**: Jest

### 6. **opencollective-images** (Image Processing Service)

Service for image upload, processing, and optimization.

**Tech Stack:**

- Image processing and optimization
- Integration with S3/MinIO storage

### 7. **opencollective-tools** (Utility Tools)

Collection of utility scripts and tools for maintenance and operations. Ignore this repository.

### 8. **opencollective-watch** (Monitoring Service)

Service for monitoring and observability. Ignore this repository.

## Infrastructure & DevOps

- **Containerization**: Docker, Docker Compose
- **Deployment**: Heroku (staging & production)
- **CI/CD**: GitHub Actions
- **Database**: PostgreSQL 14+ (primary), Redis (caching/sessions)
- **Storage**: AWS S3 (production), MinIO (local development)
- **Email**: Mailpit (local dev), production email service
- **Search**: OpenSearch
- **Monitoring**: Sentry, OpenTelemetry, Hyperwatch

## Development

### Commit message format

Across repositories we follow the same conventions. The base format is [Conventional Commits](https://www.conventionalcommits.org/): use a type and scope as appropriate (`feat`, `fix`, `chore`, `docs`, etc.), and keep the first line as a concise title. Many repos offer [commitizen](https://github.com/commitizen/cz-cli) via `npm run commit` after `git add`; using it is optional but helps learn the pattern (see each repo’s `CONTRIBUTING.md` for details).

Beyond that:

- Keep commit messages reasonably short; avoid very long titles and bodies.
- Prefer **context and user-visible impact** in the title over a dry summary of edits. Good: `fix(search): crash when searching with special characters`. Weak: `fix: update regexp in search.ts`.
- After the title, add a blank line, then **link or reference related issues** when you have them (e.g. `Fixes #123` or a URL).
- The body may also briefly **summarize what changed in the code** when that helps reviewers and future readers.
- When generating texts, avoid using "—" (em dash) and use "-" (hyphen) instead.

### Running Tests

Use `./scripts/test.sh` to run tests for any file across projects:

```bash
# Run a specific test file
./scripts/test.sh opencollective-frontend/components/MyComponent.test.tsx

# Run tests in watch mode
./scripts/test.sh --watch opencollective-api/test/server/lib/mylib.test.ts
```

The script automatically detects the project from the file path and runs the appropriate test command:

- **opencollective-frontend**: Jest (`npm run test`)
- **opencollective-api**: Mocha (`npm run test`)
- **opencollective-pdf**: Vitest (`npm run test`)
- **opencollective-rest**: Jest (`npm run test`)

## Testing manually

If available, after starting the frontend and API (./scripts/run.sh), you can start a browser at http://localhost:3000 and login with the test user `testuser+admin@opencollective.com` (no password needed).

## Connect to the database

You can manually query the dev/test databases:

- `psql postgres://opencollective@postgres/opencollective_dvl` to connect to the development database
- `psql postgres://opencollective@postgres/opencollective_test` to connect to the test database

## Security policy / Bug bounty program

See [SECURITY.md](https://github.com/opencollective/opencollective/blob/main/SECURITY.md).

## Documentation

Public: https://documentation.opencollective.com

### Specific features

- Private organizations: opencollective-api/docs/private-organizations.md
