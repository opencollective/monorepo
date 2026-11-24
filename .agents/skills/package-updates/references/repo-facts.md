# Repo facts for package-update maintenance

**Live facts come from the script**, not from this file: run
`bash "$SK/scripts/repo-facts.sh" [repo ...]` for each repo's `.nvmrc`, `engines` (Node/npm),
`renovate.json` rules, required status checks and `ci.yml` job names on the default branch.

The rest is historical observation from September to November 2026. Verify relevant settings in the
current checkout and GitHub before acting; these notes do not grant authorization or override AGENTS.md.

All six repos (api, frontend, rest, images, pdf, contributors-svg) use Renovate (Mend app) with the shared preset
`opencollective/renovate-config` (`local>` or `github>`) (`config:best-practices`, `:preserveSemverRanges`, schedule
weekdays 02:00-06:00 UTC and weekends, no automerge, `minimumReleaseAge` from best-practices except
`@opencollective/*`). Automerge is disabled by config and `allow_auto_merge` is off, so every merge
is a human decision. Renovate PR anatomy and branch handling: `renovate.md`.

**opencollective-rest** (`opencollective/opencollective-rest`, checkout `opencollective-rest/` or
`~/Dev/opencollective/rest`): npm lockfile. Its `test` job is Jest, with no database and no e2e.
Treat rest like api and frontend: batch review first, `merge.sh --approve`, never merge on green alone. Local quality:
`npm run type:check`, `npm run lint:quiet`, `npm run prettier:check`, `npm run test`. It wraps the
API's GraphQL (schema copies under `src/graphql/`), so an API schema change can break its tests.
It embeds Hyperwatch like the API does (`src/server/lib/hyperwatch.js`); see `fixing.md` §4c.
Express 5 migration notes are in `fixing.md` §4b. Re-check graphql-request's peer range before
proposing graphql 17 (7.4.0 supported graphql 14-16 only). The Codex connector reviews when
the user comments `@codex review`. Jest tests call the live API configured
in the env, not fixtures (see `failures.md`, "Flaky vs real" item 5).

**opencollective-images** (`opencollective/opencollective-images`, checkout `opencollective-images/` or
`~/Dev/opencollective/images`): npm lockfile, plain JavaScript
(Babel build, no `type:check`). Renovate **and** Dependabot both open PRs here, so the same bump can
show up twice (image-size v2: Renovate #701 `[security]` and Dependabot #700); keep the Renovate one
and close the duplicate in the batch. Besides `ci.yml` it runs `lockfile-lint.yml`. CodeQL also runs and its `CodeQL` check goes red on any _new_ alert in
changed code; it is not required. The service fetches user-provided image URLs by design, so a PR
that moves such a fetch to a new function can re-raise an existing `js/request-forgery` alert at the
new location; compare with the alerts already on main before treating it as a new exposure. One approving review is required (same as api and frontend), auto-merge is off,
squash merge is allowed. No CodeRabbit; the Codex connector reviews when the user comments
`@codex review`, otherwise the local `codex review`. The whole CI runs in about 3 minutes (test 2-3 min). Local quality: `npm run lint:quiet`,
`npm run prettier:check`, `npm run depcheck`, `npm run build`.
The `test` job is cross-repo: it checks out **api `main`**, installs and builds it, restores and
migrates the DB (Postgres + Redis services, see CI services below), then `./scripts/run_test.sh` starts
both servers and runs Jest (`test/server/*`) against them. So a red `test` with no images-side cause
usually means api main is broken or its schema moved (the images copies live in `src/graphql/`);
compare with the latest run on images main and the api main runs before blaming the bump. Locally the
Jest suite likewise needs a running API on :3060 and the images server on :3001, or set `API_FOLDER`
/ `IMAGES_FOLDER` for `run_test.sh`. The proxy suite (`proxy.routes.test.js`) needs only the images
server: start `dist/` with `NODE_ENV=production PROXY_ALLOW_PRIVATE_IP=true PORT=<p>` and run Jest with
`IMAGES_URL=http://localhost:<p>`; `routes.test.js` and the controller tests need no server.
For Express, Hyperwatch and image-proxy migration checks, see `fixing.md` §4b-4d.
Babel 8 (#711) needs `"modules": "commonjs"` in `.babelrc`: without it `dist/` keeps ESM, the server
crashes on start and the CI `test` job hangs until the 6 h timeout (no log while in progress).
Apollo Client 4 (#654) returns GraphQL errors as `error` (CombinedGraphQLErrors), not `errors`, with
`errorPolicy: 'all'`, and needs `rxjs` as a production dependency (`legacy-peer-deps` skips peers).
Check commit authors before requesting Renovate's rebase; compatibility commits require a local rebase.

**opencollective-pdf** (`opencollective/opencollective-pdf`, checkout `opencollective-pdf/` or
`~/Dev/opencollective/pdf`): runs a newer Node major than the other repos since November 2026 (see
`repo-facts.sh`; use `use_repo_node` from `_lib.sh`, Node 24 prints EBADENGINE there), npm lockfile, TypeScript (`tsc`
build, `tsx` in dev). Older notes describing it as Next.js 12 / Node 18 are outdated:
it is an Express 5 server rendering with `@react-pdf/renderer` and React 19, Apollo Client 3 and
graphql 16. Renovate opens the version updates; Dependabot opens only security updates (no
`dependabot.yml`), mostly transitive `build(deps)` / `build(deps-dev)` bumps, so the same package can
appear in both. Besides `ci.yml` it runs `lockfile-lint.yml` and CodeQL (`Analyze`). One approving
review is required, auto-merge is off, squash merge is allowed. Local quality: `npm run type:check`,
`npm run lint`, `npm run prettier:check`, `npm run depcheck`, `npm test` (Vitest).
The `test` job needs no API or database: `test/server/*` mock the GraphQL API with `nock` and compare
rendered PDFs to PNG snapshots in `test/__snapshots__` (`pdf-visual-diff`). A bump of anything in the
rendering path (`@react-pdf/*`, fonts, `pdf-visual-diff`, `canvas`/`pdfjs`, React) can move pixels:
download the `snapshots-<run-id>-*` artifact the job uploads on failure and Read the diff PNGs before
deciding between a real regression and an expected visual change (`npm run test:update` regenerates
the snapshots; that change needs the user's review). Regenerate them only where CI renders: macOS and
linux/arm64 already fail main's snapshots. `docker run --platform linux/amd64 node:24` with the
worktree copied in passes main's 48 tests; run main there first, then delete the PNGs, run once to
recreate and once with `OC_ENV=ci` to verify. `npm ci` replaces `node_modules` by itself (an
`rm -rf` in the container script is refused by Claude Code's safety check). Before committing, compare
old and new PNGs (same dimensions, per-pixel deltas with `pngjs`, a side-by-side crop of the largest
change): pdf-visual-diff 0.16 moved at most 52 edge pixels (pdf #1180). `test` also uploads to Codecov with
`fail_ci_if_error`, so a Codecov outage turns it red: an infra flake, rerun once.

**contributors-svg** (`opencollective/contributors-svg`, checkout `~/Dev/opencollective/contributors-svg`,
not in the monorepo; maintained since 2026-10-03): `engine-strict` and
`legacy-peer-deps` in `.npmrc`, plain JavaScript compiled by Babel 8 (`"modules": "commonjs"`), Express 5,
Hyperwatch 5 (`hyperwatch.app.mount`; off in production, and never runs without `HYPERWATCH_SECRET`
once #125 merges), lru-cache 11 memory cache or Redis (`REDIS_URL`). The package-updates scripts
cover it as `contributors-svg` (since 2026-10-09). Besides `ci.yml` it runs
`lockfile-lint.yml`. `test` runs `node --test` against the **source** (`@babel/register`): the real
server in a child process, controllers or GitHub stubbed by `--require` preloads, a Redis service for
`test/cache-redis.test.js` (`TEST_REDIS_URL`). `build` starts the built server with production
dependencies only (`npm ci --omit=dev` in a copy). No Codecov. Approve-and-merge from the user's
account works on bot PRs (`gh pr merge --squash --match-head-commit`); the user's own PRs need
another maintainer. Heroku app `contributors-svg` (Redis 9.1 over `rediss://`, `heroku/nodejs`
buildpack only); deploys with `npm run deploy:production`, no staging.

Heroku apps (read-only checks, e.g. `heroku redis:info -a <app>`, `heroku config -a <app>` with
secrets masked): images `oc-prod-image-server` / `oc-staging-image-server` (Redis 9.1), pdf
`oc-prod-pdf` / `oc-staging-pdf-service` (Sentry 11 with tracing off: no `SENTRY_TRACES_SAMPLE_RATE`),
api `opencollective-prod-api`, frontend `oc-prod-frontend`, rest `oc-prod-rest-api`.

**Pushing to a bot PR from your account costs your approval** (api, 2026-10-12). api #12306 (nock 15 plus a
test fix pushed from the user's account) stayed `BLOCKED` with "the base branch policy prohibits the merge"
while green, up to date and `APPROVED` by that user. Classic protection has `require_last_push_approval: false`,
so an org ruleset (unreadable without `admin:org`) most likely discounts approvals from the last pusher. A fix
pushed to a bot PR therefore needs another maintainer's approval, like the user's own PRs; say so in the push
batch item, or land the fix on main as its own PR and let the bot rebase.

**gh-aw releases are GitHub pre-releases** (2026-11-24). frontend's agentic workflows use
`github/gh-aw-actions` (`setup@`, `setup-cli@`) in `.github/workflows/agentics-maintenance.yml` and the
generated `i18n-translate-*.lock.yml`. Its tags are plain semver, so Renovate proposes them as stable,
but v1.2.3 to v1.4.0 are all marked pre-release on GitHub (v1.2.2 is the latest stable), with breaking
changes and "recompile before upgrading" in the notes. Before proposing a merge, check
`gh release view <tag> -R github/gh-aw --json isPrerelease`. The `.lock.yml` files come from
`gh aw compile` and still carry `GH_AW_VERSION` v1.0.1 (also pinned in `.github/aw/actions-lock.json`)
while the action refs moved on: that is drift to recompile, not something a Renovate bump fixes. CI does
not run these workflows. frontend #12731 (v1.3.1, a pre-release) was merged unnoticed on 2026-11-22;
#12743 (v1.4.0) was closed.

**Node Docker images carry no digest** (2026-10-15). Nothing builds the Dockerfiles of rest, images or
frontend: Heroku deploys with the `heroku/nodejs` buildpack, and the devcontainer uses its own image. Digest
PRs for `node` were noise, so renovate-config #6 sets `pinDigests: false` for `node`, and rest #800,
images #752 and frontend #12581 dropped the `@sha256` pins (main: `FROM node:24`, frontend
`FROM node:24.21`). A new node digest PR means a pin came back: close it, and check the preset.

**CI services match production** (2026-10-09). Production runs PostgreSQL 16 and Heroku Key-Value
Store, which is **Valkey**, not Redis (`heroku redis:info` says 9.1.1; Redis has no 9). CI uses
`postgres:16.15` and `valkey/valkey:9.1` (through the image entrypoint, which drops root; api #12293), with no digest:
renovate-config caps postgres `<17` and valkey `<10` and disables digest pinning for service images,
so a digest-only PR for them means a pin crept back. Valkey's floating minor tag can be a release candidate: `9.2` was `9.2.0-rc1` when Renovate proposed it (api #12298, 2026-10-10); check for a `9.x.0` GA release on valkey-io/valkey before merging a minor. Keep a version tag: a bare `redis` follows
`latest` (Codex flagged it, api #12290). The ubuntu-26.04 runner's PostgreSQL 18 `pg_restore` emits
`SET transaction_timeout`, which 16 rejects: the restore runs api's `db_restore.sh` with
`USE_DOCKER: true` (client tools from `postgres:16`). rest and images also set `SKIP_POSTINSTALL: 1`
on their api `npm ci`, whose postinstall would restore with the runner's 18 tools on a cache miss
(api and frontend skip it with `OC_ENV: ci`). Dependabot PRs get only Dependabot secrets: api,
frontend, rest and pdf have a Dependabot `CODECOV_TOKEN` (pdf #1306 failed its Codecov upload without it). api has no Dependabot `STRIPE_WEBHOOK_KEY` / `STRIPE_WEBHOOK_SIGNING_SECRET`: on a Dependabot-triggered run every `40-stripe-element-*` spec stays `NEW` and shard 4 hits its 30 min timeout (api #12291, 2026-10-10). A rerun keeps the Dependabot actor; a push from a maintainer (a local rebase) gets the repo secrets.

|                           | opencollective-api                                                   | opencollective-frontend                                              |
| ------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| GitHub                    | `opencollective/opencollective-api`                                  | `opencollective/opencollective-frontend`                             |
| Local checkout (monorepo) | `opencollective-api/`                                                | `opencollective-frontend/`                                           |
| Local checkout (outside)  | `~/Dev/opencollective/api`                                           | `~/Dev/opencollective/frontend`                                      |
| Package manager           | npm, `package-lock.json`, `engine-strict`                            | npm, `package-lock.json`                                             |
| E2E                       | `e2e.yml` on push, 5 shards named `e2e (N*.(js\|ts))`                | called from ci.yml, checks named `e2e / e2e (N*.(js\|ts))`           |
| Other workflows           | lockfile-lint, CodeQL, CodeRabbit                                    | lockfile-lint, CodeQL, CodeRabbit, i18n                              |
| Local quality             | `npm run type:check`, `npm run lint:check`, `npm run prettier:check` | `npm run type:check`, `npm run lint:quiet`, `npm run prettier:check` |
| Tests                     | Mocha (`npm run test`), needs Postgres                               | Jest (`npm run test`), Cypress e2e                                   |

Labels used by this skill in all six repos: `blocked` (`b60205`, with a "Blocked by …" comment) and
`major` (`d93f0b`, a major of a critical dependency that only the user merges).

Cross-repo coupling that bites package PRs:

- API `e2e.yml` checks out the frontend at a branch with the **same name** as the API branch when
  one exists, else frontend `main`. An orphaned `renovate/<same-slug>` branch on the other repo
  makes every e2e shard fail with GraphQL schema errors.
- api, frontend and images install each other in E2E, so they must agree on the npm major.
  `engines.npm` majors beyond what Node bundles are disabled in `renovate.json` (check with
  `repo-facts.sh`); close such PRs.
- Frontend `allowScripts` in package.json lists exact `name@version` for packages with install
  scripts (esbuild, canvas, cypress, @sentry/cli, unrs-resolver, sharp, @tailwindcss/oxide, husky).
  npm 12 silently skips a mismatched version's install script; npm 11 (local) ignores the list, so
  breakage is invisible locally. Sync the entries with the lockfile in any bump touching them.

Branch protection: one approving review is required, and `gh pr merge` without it fails with "the
base branch policy prohibits the merge". The user's account can approve bot PRs
(`gh pr review --approve`), which `merge.sh --approve` does after the review batch.
