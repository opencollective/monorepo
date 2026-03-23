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

## Development Scripts

The `/scripts` directory contains useful development utilities:

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

## Security Audits

When running a security audit on one of the projects, follow these guidelines.

### Output Format

Store findings in `priv/security-audit/` with severity-based directories and CVSS-prefixed filenames:

```
security-issues/
├── critical/          # CVSS 9.0–10.0
├── high/              # CVSS 7.0–8.9
├── medium/            # CVSS 4.0–6.9
├── low/               # CVSS 0.1–3.9
└── SUMMARY.md
```

NEVER commit any of your findings to the repository.

**Filename format:** `{CVSS_SCORE}-{category}-{short-description}.md` (e.g. `7.5-auth-tokens-in-url-query-params.md`)

**Finding template** (each `.md` file):

- Title, CVSS score, category
- Affected Code (file, lines)
- Description, Impact, Evidence
- Recommendation, References (CWE, OWASP)

### What to Test (Progressive, Critical First)

1. **Phase 1 – Critical:** Auth (JWT parsing, scope, token leakage), authorization (permissions, expense/order security), payments (Stripe, PayPal, Wise signature verification), SQL injection (queries.js, sql-search.ts, Kysely parameterization)
2. **Phase 2 – High:** OAuth (redirect URI, state, token handling), GraphQL mass assignment, file uploads (path traversal, MIME), webhooks controller
3. **Phase 3 – Medium:** Rate limiting, CORS, Helmet/CSP, session cookies (secure, httpOnly, sameSite), error handling, GraphQL Armor
4. **Phase 4 – Low:** `npm audit`, session/store config, 2FA/WebAuthn, audit logging

### Severity Assessment (CVSS)

| Severity | CVSS Range | Typical Use                                                  |
| -------- | ---------- | ------------------------------------------------------------ |
| Critical | 9.0–10.0   | Auth bypass, RCE, SQLi, payment fraud, credential theft      |
| High     | 7.0–8.9    | IDOR, webhook forgery, privilege escalation, mass assignment |
| Medium   | 4.0–6.9    | Information disclosure, weak rate limits, missing validation |
| Low      | 0.1–3.9    | Hardening opportunities, minor config issues                 |

When uncertain, use the midpoint (Critical: 9.5, High: 7.5, Medium: 5.5, Low: 2.0).

### Context from Past Audits

#### API

- **Webhooks:** Stripe, PayPal, and Transferwise verify signatures; `rawBody` is set for `/webhooks` routes in express.ts. Idempotency handled via existing transaction lookups.
- **SQL:** `queries.js`, `sql-search.ts` use parameterized queries; Kysely collection queries use proper parameterization.
- **Authorization:** ExpenseMutations, OrderMutations, PayoutMethodMutations perform permission checks; security/expense.ts and security/order.ts implement fraud checks.
- **GraphQL:** Apollo Armor enforces depth, cost, tokens, aliases; rate limiting applies to GraphQL.

### Known Issues / Exceptions

Do **not** report the following as findings; they are intentional:

- **GraphQL introspection enabled:** The API is public; introspection is on purpose.
- **Permissive CORS:** The API is public; CORS is intentionally permissive.

## Cursor Cloud specific instructions

### Environment Overview

The monorepo workspace clones sub-repositories into `/workspace/opencollective-*` directories. Each is its own git repo; run git commands from the relevant subdirectory.

### Infrastructure Services (Docker)

Docker-compose resource limits (`deploy.resources.limits`) in the compose YAML files fail in the Cloud Agent nested container environment due to cgroup restrictions. Run containers directly instead:

```bash
sudo dockerd &>/tmp/dockerd.log &
sudo docker run -d --name opencollective-postgres -p 5432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust -v opencollective-postgres-data:/var/lib/postgresql/data postgres:16
sudo docker run -d --name mailpit -p 1080:8025 -p 1025:1025 -e MP_MAX_MESSAGES=5000 -e MP_SMTP_AUTH_ACCEPT_ANY=1 -e MP_SMTP_AUTH_ALLOW_INSECURE=1 axllent/mailpit
sudo docker run -d --name minio -p 9000:9000 -p 9001:9001 -e MINIO_ROOT_USER=user -e MINIO_ROOT_PASSWORD=password -v minio-data:/data minio/minio:latest server /data --console-address :9001
```

### Starting Services

Use PM2 via the monorepo scripts: `./scripts/run.sh -b frontend api`

Or start individually:
- **API**: `cd opencollective-api && npm run dev` (port 3060)
- **Frontend**: `cd opencollective-frontend && npm run dev` (port 3000)

The frontend `.env` must contain `API_URL=http://localhost:3060` and `API_KEY=dvl-1510egmf4a23d80342403fb599qd` to connect to the local API.

### Running Tests

- **API lint**: `cd opencollective-api && npm run lint:check`
- **API tests**: `cd opencollective-api && npm run test -- test/server/models/SomeModel.test.ts` (requires test DB: `npm run db:restore:test`)
- **Frontend lint**: `cd opencollective-frontend && npx eslint --quiet -- <file>`
- **Frontend tests**: `cd opencollective-frontend && npm run test -- lib` (or `components`, `pages`)
- **Cross-project test helper**: `./scripts/test.sh opencollective-api/test/server/models/SocialLink.test.ts`

### Database

- Dev DB: `opencollective_dvl` (auto-restored on `npm install` via postinstall, or manually with `npm run db:restore`)
- Test DB: `opencollective_test` (set up with `npm run db:restore:test`)
- Migrations: `npm run db:migrate`

### Gotchas

- The API postinstall script requires PostgreSQL to be running and `psql` to be available. Use `SKIP_POSTINSTALL=1 npm install` if Postgres isn't ready yet, then run `npm run db:restore && npm run db:migrate` manually.
- Node.js 24.x is required (see `engines` in API `package.json`). Use `nvm install 24 && nvm use 24`.
- The `start-dependencies.sh` script uses `podman compose` which is not available in Cloud Agent VMs; use `docker run` directly as shown above.
- Frontend Jest uses `cross-env` wrapper; pass test file patterns as positional args, not via `--testPathPattern`.
