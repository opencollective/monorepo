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

This clones missing Open Collective projects as independent Git repositories on their `main` branch. Existing directories are left untouched, including empty directories. Rerunning setup does not fetch updates or switch branches.

To clone only the projects you need (faster setup, less disk use):

```bash
./scripts/init.sh --projects api,frontend,documentation
```

Use short names (`api`, `frontend`, `documentation`, …) or full directory names (`opencollective-api`). Only missing selected projects are cloned. Combine with `--shallow` for smaller initial clones. Run `./scripts/init.sh --help` for all options.

The devcontainer below requires the API and frontend repositories, including the API's Docker Compose files.

### Working with the project repositories

Commit and push service changes from the service's own directory. Each project is an independent repository, and project directories are ignored by the workspace repository. Update projects yourself when needed.

Setup never migrates, updates, or deletes existing repositories. An existing checkout with submodules may still have services whose Git metadata depends on the workspace's `.git`; prepare independent clones separately if you want to hide workspace Git. The hide command reports these dependencies and refuses to move metadata that they need.

### Hiding and restoring workspace Git

To let tools treat the workspace as a regular folder, hide its Git metadata manually:

```bash
./scripts/remove-git.sh
```

This moves only the root `.git` directory to `.git-backup/git`. Service Git, `.gitignore`, `.gitattributes`, and `.github` stay in place. Setup and shell shortcuts work while workspace Git is hidden. Setup never hides or restores it automatically.

To contribute to the workspace itself:

```bash
./scripts/restore-git.sh
# Make workspace changes, then commit and push them from the workspace root.
./scripts/remove-git.sh
```

These commands preserve Git state and refuse to overwrite conflicting metadata. Ordinary clones are supported; workspace Git worktrees are not. Active workspace worktrees and services linked to root Git must be handled before hiding. Independent service worktrees remain available under `.worktrees/<feature>/<repository>`; create them from their service repository as described in `AGENTS.md`.

### 2. Open in VS Code with DevContainer (Recommended)

DevContainers give you a fully configured development environment with all dependencies ready to go.

1. Install the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
2. Open the monorepo in VS Code or Cursor.
3. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) and select **"Dev Containers: Reopen in Container"**

VS Code will start with PostgreSQL, Mailpit, and other services running automatically.

### 3. Start the Application

Run the start script to launch the frontend and API:

```bash
run
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

The script automatically detects the project (frontend, api, pdf, rest) and runs the appropriate test command.

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
