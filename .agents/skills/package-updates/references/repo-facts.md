# Repo facts for package-update maintenance

Historical observations from September and October 2026. Verify relevant settings in the current checkout
and GitHub before acting; these notes do not grant authorization or override AGENTS.md.

All five repos (api, frontend, rest, images, pdf) use Renovate (Mend app) with the shared preset
`local>opencollective/renovate-config` (`config:best-practices`, `:preserveSemverRanges`, schedule
weekdays 02:00-06:00 UTC and weekends, no automerge, `minimumReleaseAge` from best-practices except
`@opencollective/*`). Automerge is disabled by config and `allow_auto_merge` is off, so every merge
is a human decision.

**opencollective-rest** (`opencollective/opencollective-rest`, checkout `opencollective-rest/` or
`~/Dev/opencollective/rest`): Node 24.x / npm 11.x, npm lockfile. CI jobs (`ci.yml`): lint,
typescript, prettier, depcheck, test (Jest, no database, no e2e). Required checks: lint, prettier,
test. Treat rest like api and frontend: batch review first, `merge.sh --approve`, never merge on green alone. Local quality:
`npm run type:check`, `npm run lint:quiet`, `npm run prettier:check`, `npm run test`. It wraps the
API's GraphQL (schema copies under `src/graphql/`), so an API schema change can break its tests.
It embeds Hyperwatch like the API does (`src/server/lib/hyperwatch.js`); see `fixing.md` §4c.
Express 5 migration notes are in `fixing.md` §4b. Re-check graphql-request's peer range before
proposing graphql 17 (7.4.0 supported graphql 14-16 only). The Codex connector reviews when
the user comments `@codex review`. Jest tests call the live API configured
in the env, not fixtures (see `failures.md`, "Flaky vs real" item 5).

**opencollective-images** (`opencollective/opencollective-images`, checkout `opencollective-images/` or
`~/Dev/opencollective/images`): Node 24.x / npm 11.x (`.nvmrc` = 24), npm lockfile, plain JavaScript
(Babel build, no `type:check`). Renovate **and** Dependabot both open PRs here, so the same bump can
show up twice (image-size v2: Renovate #701 `[security]` and Dependabot #700); keep the Renovate one
and close the duplicate in the batch. `renovate.json` on main disables `engines.npm` majors like api.
CI jobs (`ci.yml`): lint, prettier, depcheck, test; plus `lockfile-lint.yml`. Required checks: lint,
prettier, test. CodeQL also runs and its `CodeQL` check goes red on any _new_ alert in
changed code; it is not required. The service fetches user-provided image URLs by design, so a PR
that moves such a fetch to a new function can re-raise an existing `js/request-forgery` alert at the
new location; compare with the alerts already on main before treating it as a new exposure. One approving review is required (same as api and frontend), auto-merge is off,
squash merge is allowed. No CodeRabbit; the Codex connector reviews when the user comments
`@codex review`, otherwise the local `codex review`. The whole CI runs in about 3 minutes (test 2-3 min). Local quality: `npm run lint:quiet`,
`npm run prettier:check`, `npm run depcheck`, `npm run build`.
The `test` job is cross-repo: it checks out **api `main`**, installs and builds it, restores and
migrates the DB (Postgres 18 + Redis services), then `./scripts/run_test.sh` starts
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
`~/Dev/opencollective/pdf`): Node 24.x / npm 11.x (`.nvmrc` = 24), npm lockfile, TypeScript (`tsc`
build, `tsx` in dev). Older notes describing it as Next.js 12 / Node 18 are outdated:
it is an Express 5 server rendering with `@react-pdf/renderer` and React 19, Apollo Client 3 and
graphql 16. Renovate opens the version updates; Dependabot opens only security updates (no
`dependabot.yml`), mostly transitive `build(deps)` / `build(deps-dev)` bumps, so the same package can
appear in both. CI jobs (`ci.yml`): lint, prettier, typescript, test, check-tax-forms-config, depcheck;
plus `lockfile-lint.yml` and CodeQL (`Analyze`). Required checks: lint, prettier, test. One approving
review is required, auto-merge is off, squash merge is allowed. Local quality: `npm run type:check`,
`npm run lint`, `npm run prettier:check`, `npm run depcheck`, `npm test` (Vitest).
The `test` job needs no API or database: `test/server/*` mock the GraphQL API with `nock` and compare
rendered PDFs to PNG snapshots in `test/__snapshots__` (`pdf-visual-diff`). A bump of anything in the
rendering path (`@react-pdf/*`, fonts, `pdf-visual-diff`, `canvas`/`pdfjs`, React) can move pixels:
download the `snapshots-<run-id>-*` artifact the job uploads on failure and Read the diff PNGs before
deciding between a real regression and an expected visual change (`npm run test:update` regenerates
the snapshots; that change needs the user's review). `test` also uploads to Codecov with
`fail_ci_if_error`, so a Codecov outage turns it red: an infra flake, rerun once.

|                             | opencollective-api                                                                                                   | opencollective-frontend                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| GitHub                      | `opencollective/opencollective-api`                                                                                  | `opencollective/opencollective-frontend`                                                            |
| Local checkout (monorepo)   | `opencollective-api/`                                                                                                | `opencollective-frontend/`                                                                          |
| Local checkout (outside)    | `~/Dev/opencollective/api`                                                                                           | `~/Dev/opencollective/frontend`                                                                     |
| Node / npm                  | 24.x / 11.x (`.nvmrc` = 24, `engine-strict`)                                                                         | 24.x / 11.x                                                                                         |
| Package manager             | npm, `package-lock.json`                                                                                             | npm, `package-lock.json`                                                                            |
| CI workflow jobs (`ci.yml`) | lint, prettier, typescript, depcheck, ts-unused-exports, build, test, test-graphql, schema-update, graphql-inspector | lint, prettier, depcheck, ts-unused-exports, check-langs, build, test, typescript, e2e-prepare, e2e |
| E2E                         | `e2e.yml` on push, 5 shards named `e2e (N*.(js\|ts))`                                                                | called from ci.yml, checks named `e2e / e2e (N*.(js\|ts))`                                          |
| Other workflows             | lockfile-lint, CodeQL, CodeRabbit                                                                                    | lockfile-lint, CodeQL, CodeRabbit, i18n                                                             |
| Required checks             | build, lint, prettier, test, test-graphql, typescript, e2e 0-4                                                       | check-langs, lint, prettier, test, build, e2e 0-3                                                   |
| Local quality               | `npm run type:check`, `npm run lint:check`, `npm run prettier:check`                                                 | `npm run type:check`, `npm run lint:quiet`, `npm run prettier:check`                                |
| Tests                       | Mocha (`npm run test`), needs Postgres                                                                               | Jest (`npm run test`), Cypress e2e                                                                  |

Labels used by this skill in all five repos: `blocked` (`b60205`, with a "Blocked by …" comment) and
`major` (`d93f0b`, a major of a critical dependency that only the user merges; api #11701 stripe v22
is the first one).

Renovate PR anatomy: branch `renovate/<slug>`, title `fix(deps): update dependency X to vN` /
`chore(deps): update ...` / `chore(deps): lock file maintenance` (weekly).
The body ends with `- [ ] <!-- rebase-check -->If you want to rebase/retry this PR, check this box`.
Ticking it (editing the body to `[x]`) makes Renovate rebase onto main and force-push on its next
run, which also retriggers CI. Renovate also sets two commit statuses of its own: `renovate/stability-days`
(minimum release age) and `renovate/artifacts`, which fails when Renovate could not regenerate the
lockfile in its sandbox; that failure has no CI run behind it, only an "Artifact update problem" comment. Renovate stops auto-rebasing a branch once someone else pushes to it (the branch is "modified").
Ticking the box on a modified branch makes Renovate rebuild the branch from its own update, which
drops the foreign commits. So: push a compat fix onto the Renovate branch only when the branch is
already rebased on current main; if the branch later needs a rebase, do it locally
(`git rebase origin/main` + `--force-with-lease`) rather than through the checkbox.

Cross-repo coupling that bites package PRs:

- API `e2e.yml` checks out the frontend at a branch with the **same name** as the API branch when
  one exists, else frontend `main`. An orphaned `renovate/<same-slug>` branch on the other repo
  makes every e2e shard fail with GraphQL schema errors.
- api, frontend and images install each other in E2E, so they must agree on the npm major.
  `engines.npm` majors beyond what Node bundles are disabled in `renovate.json`; close such PRs.
- Frontend `allowScripts` in package.json lists exact `name@version` for packages with install
  scripts (esbuild, canvas, cypress, @sentry/cli, unrs-resolver, sharp, @tailwindcss/oxide, husky).
  npm 12 silently skips a mismatched version's install script; npm 11 (local) ignores the list, so
  breakage is invisible locally. Sync the entries with the lockfile in any bump touching them.

Branch protection: one approving review is required, and `gh pr merge` without it fails
with "the base branch policy prohibits the merge". The user's account can approve bot PRs
(`gh pr review --approve`), which `merge.sh --approve` does after the review batch. Nobody can
approve their own PR. Use an existing qualifying review or report that another reviewer is needed;
`merge.sh` never bypasses protection or recommends an administrative merge.

Local environment: the non-interactive shell may pick Node 20 from nvm. Prefix with
`use_node24` from `scripts/_lib.sh` (verify `node --version` and `npm --version`) before
`npm ci`, `tsc` or tests.
