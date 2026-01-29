# Open Collective Monorepo

A centralized workspace for all Open Collective projects, providing a unified development environment with shared configurations, devcontainers, and tools.

This workspace serves as:

- **Central Development Hub**: Clone and setup all Open Collective projects at once
- **DevContainer Configuration**: Quick development environment setup with Docker
- **Shared IDE Configuration**: VS Code workspace settings and extensions
- **Common Tools & Configs**: Shared configs, scripts, and development utilities

## Why use this monorepo?

1. It makes the whole setup easier. Dependencies are started automatically (in Docker).
2. Dev containers make it safer to run the code, and will especially prevent:
   - Attacks through the dependency chain (local packages don't get access to the host)
   - Prompt injection attacks when using an agent

To take full advantage of these benefits, it is recommended that you go through the "Additional recommendations" section below after setting up the monorepo.

## Getting Started

### Prerequisites

- Git
- Docker or Podman (for the recommended DevContainer setup)
- Alternatively, check each project's README for manual setup instructions

### 1. Clone the Workspace

```bash
git clone https://github.com/opencollective/opencollective-monorepo.git opencollective
cd opencollective
./scripts/init.sh
```

This clones all Open Collective projects into a single workspace.

### 2. Open in VS Code with DevContainer (Recommended)

DevContainers give you a fully configured development environment with all dependencies ready to go.

1. Install the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
2. Open `opencollective-workspace-simple.code-workspace` (includes frontend + API)
3. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) and select **"Dev Containers: Reopen in Container"**

VS Code will start with PostgreSQL, Mailpit, and other services running automatically.

### 3. Start the Application

Run the start script to launch the frontend and API:

```bash
./scripts/run.sh
```

**Access the app:**

- Frontend: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:3060](http://localhost:3060)
- Mail server: [http://localhost:1080](http://localhost:1080)

**Start specific services:**

```bash
./scripts/run.sh frontend           # Frontend only
./scripts/run.sh frontend api       # Frontend and API
./scripts/run.sh frontend:staging   # Frontend connected to staging
```

---

## Running Tests

Use the unified test script to run tests across any project:

```bash
# Run a specific test file
./scripts/test.sh opencollective-frontend/components/MyComponent.test.tsx

# Run tests in watch mode
./scripts/test.sh --watch opencollective-api/test/server/lib/mylib.test.ts
```

The script automatically detects the project (frontend, api, pdf, rest) and runs the appropriate test command.

---

## Additional recommendations

- **NEVER** store production secrets in these repositories. If you need to use production secrets, clone a separate instance of the repository that is dedicated to that purpose, and never use it with agents/for development.
- In VSCode settings, set `dev.containers.enableGPGAgentForwarding` and `dev.containers.enableSSHAgentForwarding` to false, and use git from the host machine. This will prevent the dev container from using the host machine's git configuration, which could be exploited by malicious code to silently push updates.

---

## Manual Setup (Without DevContainer)

If you prefer not to use DevContainers:

1. Start dependencies: `./scripts/start-dependencies.sh`
2. Navigate to individual project directories (`opencollective-api`, `opencollective-frontend`)
3. Follow the setup instructions in their README files

---

## Contributing to the Monorepo

The `init.sh` script removes `.git` after setup to avoid VS Code conflicts. To make changes to the monorepo itself:

```bash
./scripts/restore-git.sh   # Restore git
# Make your changes and commits
./scripts/remove-git.sh    # Remove git again
```
