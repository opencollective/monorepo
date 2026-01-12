# Open Collective Monorepo

A centralized workspace for all Open Collective projects, providing a unified development environment with shared configurations, devcontainers, and tools.

This workspace serves as:

- **Central Development Hub**: Clone and setup all Open Collective projects at once
- **DevContainer Configuration**: Quick development environment setup with Docker
- **Shared IDE Configuration**: VS Code workspace settings and extensions
- **Common Tools & Configs**: Shared configs, scripts, and development utilities

## Quick Start

### Prerequisites

- Git
- Docker/Podman (for devcontainers)
- If not using devcontainers: check individual project's README for specific setup instructions

**Clone this workspace and initialize all projects**:

```bash
git clone https://github.com/opencollective/opencollective-monorepo.git opencollective
cd opencollective
./scripts/init.sh
```

This will clone all projects into the root directory.

### Running the projects

#### Option 1: Using DevContainer (Recommended)

##### With VS Code Dev Containers

**Opening the projects in VS Code**:

1. Install the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
2. Open one of the `.code-workspace` files in the. We recommend using `opencollective-workspace-simple.code-workspace` (a version with only the frontend and the API) in most cases.
3. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) and select "Dev Containers: Reopen in Container"

VS Code will start with the required services (postgres, mailpit, etc.) running and a shell setup with all the necessary tooling. You will still need to install dependencies and start individual projects.

**Starting the projects**:

- Use the `./scripts/run.sh` script.
- Alternatively, you could start project simply by opening a terminal (in containereized VS code) and run `npm install` followed by `npm run dev`.

You can then access the frontend at [http://localhost:3000](http://localhost:3000) and the API at [http://localhost:3060](http://localhost:3060).

#### Option 2: Manual Setup

Dependencies: you can use the `./scripts/start-dependencies.sh` script to start the dependencies.
Projects: Just navigate to the project directories (you'll probably want to start with opencollective-api and opencollective-frontend) and follow the instructions in their respective README files.

## Editing the monorepo

By default, the `init.sh` script remove git once it's done, as it confuses vscode. To commit something to the monorepo:

```bash
$ ./scripts/restore-git.sh # Restore git
$ # Do your changes and git operations here
$ ./scripts/remove-git.sh # Remove git again
```

## Getting Help

- **Discord**: Join our [Discord community](https://discord.opencollective.com)
- **Issues & Discussions**: [GitHub](https://github.com/opencollective/opencollective)
