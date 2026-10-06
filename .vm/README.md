# Open Collective development VM

An Ubuntu 24.04 VM runs the development tools, Docker, and databases. Your local
monorepo is shared read-write at `/workspace`, including repositories, worktrees,
`.env` files, and `node_modules`. Guest edits and dependency installation affect
that same checkout on the host.

## Setup

Use a Linux x86_64 host with KVM (`/dev/kvm`), a local Incus 6.23+ daemon with QEMU
support, Node.js 20+, OpenSSH, and iproute2. Your regular user needs administrative
access to Incus. Run the launcher without `sudo`.
[Install Incus](https://linuxcontainers.org/incus/docs/main/installing/).

From a local monorepo checkout containing the API, frontend, REST, PDF, images,
and taxes repositories:

```bash
./scripts/vm.sh doctor
cp .vm/.vm.local.example.json .vm/.vm.local.json # Optional customization
./scripts/vm.sh setup
```

Setup creates and provisions the VM, installs Ubuntu's HWE kernel, asks for your
Git commit identity, installs project dependencies, and prepares PostgreSQL,
Mailpit, and RustFS. It reboots once to activate the HWE kernel before marking a
new VM ready. Missing service directories must be prepared in the host checkout.
GitHub access is not needed to initialize the development stack. Rerunning setup
preserves existing Git identity, `.env` values, and databases.

The guest user is `ubuntu`, with your host UID/GID for shared-file access.
The launcher creates dedicated Incus resources without changing daemon defaults.
Keep the host checkout at the same path.

## Configuration

Settings come from `OC_VM_<UPPERCASE_SETTING>` environment variables, then
`.vm/.vm.local.json`, then these defaults:

| Setting           | Default                     | Purpose                             |
| ----------------- | --------------------------- | ----------------------------------- |
| `cpus`            | `8`                         | Virtual CPUs                        |
| `memory_mb`       | `43008`                     | RAM in MiB (42 GiB)                 |
| `disk_gb`         | `100`                       | Guest root disk capacity in GiB     |
| `image`           | `images:ubuntu/24.04/cloud` | Ubuntu 24.04 amd64 VM image         |
| `project`         | `oc-development`            | Dedicated Incus project             |
| `instance_name`   | `oc-dev`                    | Incus VM name                       |
| `storage_pool`    | `oc-development`            | Dedicated dir pool or existing pool |
| `network_name`    | `oc-development`            | Managed bridge                      |
| `network_address` | `192.168.121.0/24`          | Private IPv4 subnet                 |
| `git_protocol`    | `https`                     | GitHub Git transport: https or ssh  |

For example: `OC_VM_CPUS=4 OC_VM_MEMORY_MB=16384 ./scripts/vm.sh up`.
Keep overrides in the JSON file or supply them consistently. Stop the VM before
changing CPU, RAM, or disk capacity; disk capacity can grow but cannot shrink.
Project, pool, network, and checkout location must remain consistent for a VM.

Tool versions are in `.vm/versions.json`. The root disk stores installed tools,
Docker data, and the guest home directory; the shared checkout stays on the host.

## GitHub Git access

With `git_protocol: "https"`, guest Git rewrites GitHub SSH URLs to HTTPS and
obtains credentials through `gh auth git-credential`, using `gh` from the current
session's `PATH`. Use the `gh` authentication available in your Orca remote
session. Setup configures the helper without signing in or storing credentials.

With `git_protocol: "ssh"`, guest Git rewrites GitHub HTTPS URLs to SSH.
Developers choosing this mode manage GitHub SSH authentication themselves.
The protocol setting applies inside the VM; stored repository remotes stay intact.
Run `./scripts/vm.sh up` after changing it.

## Connect

```bash
ssh oc-dev
./scripts/vm.sh ssh                     # Interactive session
./scripts/vm.sh ssh node --version      # Remote command
./scripts/vm.sh guest bash              # Remote command with a terminal
./scripts/vm.sh ssh-config --install    # Refresh the oc-dev SSH entry
```

Interactive SSH sessions start in `/workspace`. The launcher installs
`~/.ssh/oc-development.conf` and includes it from `~/.ssh/config`. Its dedicated VM
login key stays outside the checkout under
`${XDG_STATE_HOME:-$HOME/.local/state}/opencollective-vm/`.

In Orca, add `oc-dev` under **Settings → SSH**, select `/workspace` as the remote
project location, and use **Run on → oc-dev**. Add each service as its own project
when working with service repositories.

In VS Code, install **Remote - SSH**, connect to `oc-dev`, and open `/workspace`.
Workspace Git can be hidden manually with `./scripts/remove-git.sh` and restored
with `./scripts/restore-git.sh`; the guest health check supports either state.

Create service worktrees inside the VM under
`/workspace/.worktrees/<feature>/<repository>`, following the service's `AGENTS.md`.

Optional agent logins run separately:

```bash
./scripts/vm.sh guest codex login --device-auth
./scripts/vm.sh guest opencode auth login
```

## Development

In a guest terminal:

```bash
oc-dependencies                  # PostgreSQL, Mailpit, RustFS
run frontend api
# Other services: run frontend api rest pdf images
# Optional search: oc-dependencies db mail uploads search
```

Forward the needed ports through Orca or VS Code, using matching local ports:

| Service        | Port |
| -------------- | ---- |
| Frontend       | 3000 |
| Images         | 3001 |
| PDF            | 3002 |
| REST           | 3003 |
| API            | 3060 |
| Mailpit        | 1080 |
| RustFS S3      | 9000 |
| RustFS console | 9001 |
| PostgreSQL     | 5432 |

Open http://localhost:3000 and sign in as `testuser+admin@opencollective.com`
(no password). Run each service's tests and quality checks inside the VM.
Service worktrees use `npm run dev` from their directory; standard application
ports are shared across worktrees.

## VM management

```bash
./scripts/vm.sh up          # Create or start the VM
./scripts/vm.sh stop
./scripts/vm.sh restart
./scripts/vm.sh status
./scripts/vm.sh provision   # Refresh tools and VM configuration
./scripts/vm.sh destroy     # Delete guest disk/data and dedicated VM resources
```

Stop/start and reprovisioning preserve guest data. Destroy leaves the host checkout
intact. Run `doctor` for host prerequisites; startup errors identify the failed
stage and include cloud-init diagnostics when applicable.

## Validation

```bash
node --test scripts/*.test.mjs .vm/*.test.mjs
shellcheck -S warning -x .vm/*.sh scripts/init.sh scripts/projects.sh scripts/remove-git.sh scripts/restore-git.sh scripts/vm.sh scripts/start-dependencies.sh .devcontainer/shell-aliases.sh
```

Live checks require the KVM host: run setup, verify shared writes and ownership,
connect through SSH/Orca/VS Code, check GitHub HTTPS access in an Orca session,
and run frontend/API with an email and upload. Verify guest data and shared work
survive stop/start and reprovisioning.
