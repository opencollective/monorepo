# Open Collective Monorepo

A centralized workspace for all Open Collective projects, providing a unified development environment with shared configurations, devcontainers, and tools.

This workspace serves as:

- **Central Development Hub**: Clone and setup all Open Collective projects at once
- **DevContainer Configuration**: Quick development environment setup with Docker
- **Shared IDE Configuration**: VS Code workspace settings and extensions
- **Common Tools & Configs**: Shared configs, scripts, and development utilities

## Why use this monorepo?

1. It makes the whole setup easier. Dependencies are started automatically (in Docker).
2. Dev containers make it safer to run the code, and will especially limit:
   - Attacks through the dependency chain (local packages don't get access to the host)
   - Prompt injection attacks when using an agent

To take full advantage of these benefits, it is recommended that you go through the "Additional recommendations" section below after setting up the monorepo.

## Getting Started

For a persistent KVM development machine (accessed through Orca and VS Code Remote
SSH, for example), follow [the development VM guide](.vm/README.md). It installs the
toolchain and Docker inside the VM.
Start its interactive setup with `./scripts/vm.sh setup` after installing the host
prerequisites. The DevContainer workflow below remains available.

### Prerequisites

- Git
- Docker or Podman (for the recommended DevContainer setup)
- Alternatively, check each project's README for manual setup instructions

### 1. Clone the Workspace

```bash
git clone https://github.com/opencollective/monorepo.git opencollective
cd opencollective
./scripts/init.sh
```

This initializes all Open Collective projects as Git submodules and checks out the latest `origin/main` on a local `main` branch. Every subsequent run fetches and updates the projects again.

To clone only the projects you need (faster setup, less disk use):

```bash
./scripts/init.sh --projects api,frontend,documentation
```

Use short names (`api`, `frontend`, `documentation`, …) or full directory names (`opencollective-api`). Only selected projects are cloned or updated. Combine with `--shallow` for smaller initial clones. Run `./scripts/init.sh --help` for all options.

The devcontainer below requires the API and frontend repositories, including the API's Docker Compose files.

### Working with the project repositories

Commit and push service changes from the service's own directory. Submodules use `ignore = all`, so edits, commits, and branch switches inside them do not appear as changes in the workspace repository. Explicitly staged submodule commit pointers still appear and can be committed.

Rerunning `init.sh` switches selected projects back to `main` and fast-forwards them to the latest `origin/main`. Feature branches remain available. If a project has uncommitted changes or commits on `main` that are not on `origin/main`, the script preserves that work, reports an error, and continues updating the other projects. It exits with a nonzero status if any project fails. Commit or stash uncommitted changes, or reconcile local `main` commits, before retrying.

Existing repositories cloned by older versions of the setup script are adopted as submodules automatically. The script does not stage updated submodule commit pointers in the workspace.

Git records a commit pointer for each submodule, but the setup script intentionally follows the latest `main` rather than those recorded commits. Plain `git submodule update --init` uses the recorded commits and usually leaves a detached HEAD; use `./scripts/init.sh` for this development workflow.

### 2. Open in VS Code with DevContainer (Recommended)

DevContainers give you a fully configured development environment with all dependencies ready to go.

1. Install the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
2. Open the monorepo in VS Code or Cursor.
3. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) and select **"Dev Containers: Reopen in Container"**

VS Code will start with PostgreSQL, Mailpit, and other services running automatically.

### 3. Start the Application

Install the root toolchain and service dependencies, then launch the frontend and API:

```bash
./scripts/install-dependencies.sh frontend api
npm run dev
```

**Access the app:**

- Frontend: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:3060](http://localhost:3060)
- Mail server: [http://localhost:1080](http://localhost:1080)

**Start specific services:**

```bash
run frontend           # Frontend only
run frontend api       # Frontend and API
run frontend:staging   # Frontend connected to staging
```

---

## Running Tests

Use the unified test script to run tests across any project:

```bash
# Run a specific test file
test opencollective-frontend/components/MyComponent.test.tsx

# Run tests in watch mode
test --watch opencollective-api/test/server/lib/mylib.test.ts
```

The script automatically detects frontend, API, PDF, REST, images, taxes, and RSS test files and runs the appropriate test command.

## Shell shortcuts

In the devcontainer, `run` and `test` aliases are set up automatically. Outside the devcontainer, use `./scripts/run.sh` and `./scripts/test.sh`. If you get `run: command not found`, restart the devcontainer.

---

## Additional recommendations

- **NEVER** store production secrets in these repositories. If you need to use production secrets, clone a separate instance of the repository that is dedicated to that purpose, and never use it with agents/for development.
- In VSCode settings, set `dev.containers.enableGPGAgentForwarding` and `dev.containers.enableSSHAgentForwarding` to false, and use git from the host machine. This will prevent the dev container from using the host machine's git configuration, which could be exploited by malicious code to silently push updates.

---

## Manual Setup (Without DevContainer)

If you prefer not to use DevContainers:

1. Start dependencies: `./scripts/start-dependencies.sh --detach db mail uploads`
2. Navigate to individual project directories (`opencollective-api`, `opencollective-frontend`)
3. Follow the setup instructions in their README files
4. Install orchestration tooling with `npm run install:tooling`

## Turborepo workflow

Turbo orchestrates the eight npm repositories. Each repository keeps its own
`node_modules`, npm lockfile, Git history, CI, and deployment entrypoints. The root
workspace manifest describes package discovery, not a shared dependency install.
Use `npm run install:tooling` for the separately locked Turbo/Prettier toolchain,
and `./scripts/install-dependencies.sh [frontend api ...]` for isolated service
installs. Do not use `npm install` or `npm ci` at the workspace root: npm resolves
all workspace dependency trees even with workspace installation disabled.

The launcher generates an ignored root lockfile containing package-graph metadata.
It does not replace service lockfiles or install service dependencies. Each cached
task explicitly hashes its service lockfile; the launcher also supplies a per-service
lockfile digest because the graph lock does not resolve external dependencies. Missing submodules are omitted; an
explicit selection of an uninitialized service reports an error. Re-run setup
after adding repositories.

```bash
npm run dev                         # frontend and API
run frontend:staging api             # environment choice applies to frontend only
npm run dev -- rss documentation     # additional service and docs preview
npm run build                       # initialized packages that provide builds
npm run check                       # lint, types, formatting, docs validation
npm run test -- frontend taxes       # unit test tasks for selected services
npm run format                      # write formatting changes; never cached
npm run turbo -- run lint --filter=opencollective-api
npm run turbo -- run build:finalize --filter=opencollective-frontend --dry=json
```

Tasks execute concurrently according to their prerequisites. The frontend Next.js
build precedes its server copy, which precedes Cloudflare IP refresh. Compilation
artifacts are cached; Cloudflare refresh always runs after restoration. Development,
watch tasks, schema refresh, database changes, API database tests, and E2E execution
are uncached. Service processes retain their existing reload tools. Interactive
`run` sessions show Turbo's terminal UI; noninteractive sessions stream logs.
Ctrl-C stops the session. PM2 and `run --background` have been removed.

`./scripts/test.sh [--watch] <service/test-file>...` forwards file arguments to the
selected runner through Turbo. `./scripts/update-gql.sh [service...]` refreshes
API/frontend/PDF schemas against the running API. REST/images copy frontend
schemas when available and otherwise fetch their published schemas. When frontend
is selected, copying waits for its refresh and code generation.

Dependency installation and manual npm linking keep their existing behavior.
Turbo does not create or remove package links. When working with manually linked
packages, disable task-result caching with `--cache=local:,remote:`.

### Standalone repositories and CI

Inside a service, use `npm run turbo -- run <task>` or the existing `npm run build`
entrypoint. `turbo.json` contains workspace overrides; `turbo.standalone.json`
contains the corresponding standalone graph. Update both when changing tasks.
Independent `npm ci` installs and Heroku builds remain supported.

Frontend and API CI use Vercel Remote Cache through GitHub OIDC on trusted main
pushes. Keep the existing `TURBO_TEAM` Actions variable. Create Vercel Turborepo
CLI OIDC policies for the API and frontend repositories, restricted to `main`,
in team Settings → Build and Deployment → OIDC Policies for CLI Access. Policies
must cover their CI and E2E workflows, including frontend's reusable E2E
preparation workflow. Use the default audience.

Jobs grant `id-token: write`; Vercel's setup action exports a short-lived cache
token before Turbo runs and revokes it afterward. No `TURBO_TOKEN` repository
secret is required. PRs and runs without `TURBO_TEAM` use local caching.

Dependency downloads, E2E build artifact uploads, coverage reporting, and service
readiness/cleanup remain separate from task-result caching.

Adopt service changes before the root workflow: taxes/RSS/documentation and
images/PDF/REST first, then API/frontend together. Their E2E stack checkouts must
contain the companion Turbo changes. Commit service changes from their individual
feature worktrees, then update workspace submodule pointers explicitly if desired.
Git-based `--affected` filtering at the parent cannot reliably detect independent
submodule edits; use package filters and task caching there.

See [Turbo CI](https://turborepo.dev/docs/crafting-your-repository/constructing-ci)
and [Vercel OIDC setup](https://vercel.com/docs/monorepos/remote-caching/external-ci-cd#create-an-oidc-policy).
