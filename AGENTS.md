# Open Collective

If `docs/agents/developer-specific-instructions.md` exists, read and follow it. If it does not exist, proceed silently.

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

**Infra:** Docker Compose; Heroku staging/prod; GitHub Actions; Postgres 14+, Redis; S3 prod / MinIO local; Mailpit local; OpenSearch; Sentry/OpenTelemetry/Hyperwatch.

## Development

**Git worktrees:** Work in a Git worktree for each repository you change. Store worktrees under `/workspace/.worktrees/`, using a feature name and repository name in each path (for example, `.worktrees/<feature>/opencollective-api` and `.worktrees/<feature>/opencollective-frontend`). For a feature spanning multiple repositories, reuse the same `<feature>` directory name in each repository's worktree path. Create and manage each worktree from its own repository; never create a worktree for `/workspace` itself.

**Commits:** [Conventional Commits](https://www.conventionalcommits.org/) (`feat`, `fix`, `chore`, `docs`, …). Short title with user-visible impact (`fix(search): crash when searching with special characters`). Then a blank line, `Fixes opencollective/opencollective#123` or a URL, and an optional short body. Optional `npm run commit` (commitizen) after `git add`. Use hyphens, not em dashes.

**Issue and PR references:** Work spans several repos, so write every issue or PR reference (commits, PR bodies, comments, reports) as `owner/repo#number`, such as `opencollective/opencollective#4242`. GitHub links a bare `#4242` to the current repo, which is usually the wrong one.

**Quality:** From the repo subfolder, run that repo's TypeScript, ESLint, and Prettier scripts (see its `AGENTS.md`). Must pass before handoff. Repeat in every touched repo.

**PRs:** After opening a PR, run the `oc-maintain-prs` skill on it and keep iterating until the PR is fully green.

**Screenshots and videos on GitHub:** You can attach them yourself, so do not tell the user it is impossible. `gh` v2.99.0+ uploads local images and videos with the repeatable `--attach` flag on `gh pr create|edit|comment` and `gh issue create|edit|comment`. Example: `gh pr create ... --attach ./before.png --attach ./after.png`. If the body already references the local path (`![After](./after.png)`), `gh` replaces it with the uploaded URL; otherwise it appends the file. Attach before/after screenshots to UI PRs (capture them with Playwright against `./scripts/run.sh`). If `gh --version` is older than 2.99, upgrade `gh` rather than skip the screenshots. See https://gh.io/gh-attach.

**Tests:** `./scripts/test.sh <file>` (`--watch` supported). Auto-detects the runner.

**Manual:** `./scripts/run.sh` then http://localhost:3000 as `testuser+admin@opencollective.com` (no password).

**DB:** `psql postgres://opencollective@postgres/opencollective_dvl` (dev), `.../opencollective_test` (test).

## Security

Triage: `.agents/skills/security-investigate-issue` (internal), `security-investigate-report`. Known-safe patterns: `.agents/skills/review-feature-security`. **Not defects:** public GraphQL introspection, permissive API CORS.

On the API: If a PR has a security aspect (permissions, auth, 2FA, OAuth scopes, private accounts, payments, user input handling, or a security fix), add the `security` label to it. The label triggers automated security reviews.
