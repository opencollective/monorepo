# Open Collective Monorepo

[![Discord](https://discordapp.com/api/guilds/1241017531318276158/widget.png)](https://discord.opencollective.com)

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
./init.sh
```

This will clone all projects into the `apps` directory.

### Running the projects

#### Option 1: Using DevContainer (Recommended)

##### With VS Code Dev Containers

1. Install the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
2. Open one of the `.code-workspace` files in the `apps` directory. We recommend using `opencollective-workspace-simple.code-workspace` (a version with only the frontend and the API) in most cases.
3. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) and select "Dev Containers: Reopen in Container"

VS Code will start with the required services (postgres, mailpit, etc.) running and a shell setup with all the necessary tooling. You will still need to install dependencies and start individual projects. To start the frontend and the API, simply open two terminals and run `npm install` followed by `npm run dev`. You can then access the frontend at [http://localhost:3000](http://localhost:3000) and the API at [http://localhost:3060](http://localhost:3060).

#### Option 2: Manual Setup

Just navigate to the projects directories (you'll probably want to start with apps/api and apps/frontend) and follow the instructions in their respective README files.

### Getting Help

- **Discord**: Join our [Discord community](https://discord.opencollective.com)
- **Issues & Discussions**: [GitHub](https://github.com/opencollective/opencollective)
