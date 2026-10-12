# Open Collective development sandbox

[microsandbox](https://docs.microsandbox.dev) runs the development tools, Docker,
and databases in a persistent microVM. The primary host checkout is shared
read-write at `/workspace`, including service repositories, worktrees, `.env`
files, and `node_modules`. Guest edits and dependency installation affect the
same files on the host.

## Setup

Use a Linux host with KVM, microsandbox **v0.7.8 or newer**, Node.js 20+, Git, Bash,
and OpenSSH. Install the CLI using the
[official installation instructions](https://docs.microsandbox.dev/getting-started/quickstart).
Your regular user needs read/write access to `/dev/kvm`. Run setup without `sudo`.

From a monorepo checkout containing the API, frontend, REST, PDF, images, and taxes:

```bash
MSB_BACKEND=local msb doctor
./scripts/vm.sh setup
```

Setup creates `oc-dev` from upstream's Ubuntu 24.04 systemd image, installs tools
inside it, authorizes an SSH key, installs the SSH alias, and initializes the
existing PostgreSQL, Mailpit, and RustFS Compose stack. It installs project
packages and prepares development and test databases. No host Docker is needed.
Missing service repositories must be prepared on the host before setup.

When invoked from a monorepo worktree, setup selects and prints the **primary
checkout** for `/workspace`. Monorepo worktrees under that checkout's
`.worktrees` directory remain accessible there. Git metadata and existing external worktrees are
also shared at their original absolute paths when necessary; setup never rewrites
Git metadata. A mount that would hide checkout files is rejected. Keep host paths
stable, and rerun setup after adding external service worktrees; it reports mount
changes rather than silently replacing an existing sandbox.

Setup uses the invoking checkout's provisioning scripts, including when they are
in a worktree. Keep that checkout available for later tool refreshes and shell
hooks.

Rerunning setup refreshes tools and preserves existing `.env` values and databases.
If a stage fails, its sandbox is retained so you can inspect it, fix the cause, and
rerun setup. Existing sandboxes are checked for workspace ownership, resources,
mounts, runtime, and published ports before provisioning.

## Environment overrides

There are no project settings files. Set overrides when running setup:

```bash
OC_VM_CPUS=4 OC_VM_MEMORY_MB=16384 OC_VM_DISK_GB=50 ./scripts/vm.sh setup
```

| Variable              | Default                                        | Purpose                     |
| --------------------- | ---------------------------------------------- | --------------------------- |
| `OC_VM_CPUS`          | `8`                                            | Virtual CPUs                |
| `OC_VM_MEMORY_MB`     | `43008`                                        | RAM in MiB (42 GiB)         |
| `OC_VM_DISK_GB`       | `100`                                          | Docker data disk in GiB     |
| `OC_VM_INSTANCE_NAME` | `oc-dev`                                       | Sandbox and SSH alias       |
| `OC_VM_IMAGE`         | `ghcr.io/superradcompany/ubuntu-systemd:24.04` | Ubuntu image with systemd   |
| `OC_VM_SSH_KEY`       | `~/.ssh/oc-dev_ed25519.pub`                    | Public key with private key |

`OC_VM_DISK_GB` also sets the additional guest-write allowance for each shared
host directory. It does not reserve that space on the host.

These settings apply at creation. Supply matching values on setup reruns.
Use native `msb modify` for supported resource changes and then use corresponding
environment values on subsequent setup runs. For mount/image/port changes, use a
different sandbox name or explicitly remove the old sandbox after saving guest data.
The setup helper never replaces a sandbox automatically.

The helper selects `MSB_BACKEND=local` and verifies the effective backend;
managed policies can override that selection. `MSB_HOME` and `MSB_CONFIG_PATH`
are honored and recorded in the SSH ProxyCommand. Keep the same values for native
administration commands. Setup does not modify microsandbox's global configuration.

## Storage and services

The launcher does **not** pass `--root-disk`. Microsandbox's local default is a
layered root with 4 GiB of writable space, unless global settings override it.
Installed tools and the guest home live there. Source files and project packages
live in the host checkout.

Docker uses a separate [owned ext4 disk](https://docs.microsandbox.dev/sandboxes/volumes#owned-volumes)
at `/var/lib/docker`. Its images, containers, and database/upload volumes survive
stop/start and are removed with the sandbox. Docker is configured to use classic
`overlay2`, keeping image storage on this disk instead of the containerd image
store's separate root location. Existing custom Docker configuration is preserved;
provisioning reports incompatible storage configuration.

Systemd starts Docker on each boot. Stopping a sandbox stops processes; starting
it preserves files but does not resume applications. Run `oc-dependencies` again
to bring up the dependency containers, then restart the application services.
Use `df -h / /var/lib/docker` and `msb inspect` to check storage usage.

## SSH and editors

```bash
ssh oc-dev
ssh oc-dev node --version
sftp oc-dev
```

Setup creates or reuses the dedicated default key outside the checkout. For an
existing key pair, set `OC_VM_SSH_KEY` to its `.pub` file; setup expects the private
key beside it. It never copies private keys into the guest.

[microsandbox SSH](https://docs.microsandbox.dev/sandboxes/ssh) serves OpenSSH through
`ProxyCommand msb ssh serve oc-dev --stdio`, using `msb ssh authorize` for public
key authorization. There is no guest SSH daemon or persistent host SSH listener.
Authorization is shared across the selected `MSB_HOME`. The launcher updates only
`~/.ssh/oc-development.conf` and its Include in `~/.ssh/config`, preserving other
entries. Host keys use a separate microsandbox known-hosts file. Recreating a
sandbox may require removing its old entry with:

```bash
ssh-keygen -R oc-dev-microsandbox -f ~/.ssh/oc-microsandbox-known_hosts
```

Sessions run as `ubuntu` (guest UID/GID 1000) and start in `/workspace`.
Native bind ownership exposes this identity without changing host inode ownership.
SSH sessions have their inactivity timeout disabled and use keepalives.

In Orca, add `oc-dev` under **Settings → SSH**, select `/workspace`, and use
**Run on → oc-dev**. In VS Code, connect with **Remote - SSH** and open `/workspace`.
Keep **Remote Server Listen On Socket** disabled: microsandbox supports TCP
forwarding, but not Unix-socket or reverse forwarding.

Git is installed, but setup does not copy/configure commit identity, remotes,
transport rewrites, credentials, or authentication. Configure guest Git and any
provider logins yourself. For agent logins:

```bash
MSB_BACKEND=local msb exec --user ubuntu oc-dev -- codex login --device-auth
MSB_BACKEND=local msb exec --user ubuntu oc-dev -- opencode auth login
```

## Development

In a guest terminal:

```bash
oc-dependencies                      # PostgreSQL, Mailpit, RustFS
run frontend api
# Other services: run frontend api rest pdf images
# Optional search: oc-dependencies db mail uploads search
```

These ports are published directly on host **127.0.0.1**; editor forwarding is
unnecessary. If a host port is occupied, resolve the conflict before starting the
sandbox. Another sandbox publishing the same ports cannot run alongside it.

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
(no password). Run each service's tests and checks inside the sandbox.
Service worktrees use `npm run dev` from their directory; application ports are
shared across worktrees. Forward optional search ports with editor forwarding or
`ssh -L` when needed.

## Native administration

```bash
export MSB_BACKEND=local
msb start oc-dev
msb stop oc-dev --timeout 30
msb restart oc-dev --timeout 30
msb ps oc-dev
msb inspect oc-dev
msb logs oc-dev
msb exec --user ubuntu oc-dev -- bash
```

To refresh just the toolchain, use the provisioning script from the checkout that
ran setup (adjust its `/workspace` path if it is a monorepo worktree):

```bash
msb exec --user root oc-dev -- bash /workspace/.vm/provision.sh
```

`msb exec` temporarily starts a stopped sandbox and stops it again afterward;
use `msb start` first for a persistent development session. The SSH ProxyCommand
also starts a stopped sandbox automatically.

To delete guest data, stop the sandbox, then explicitly run `msb rm oc-dev`.
This deletes its guest home and Docker disk, while leaving host-mounted files
intact. Native removal leaves the project SSH fragment/key and the global
microsandbox authorized key list in place for reuse.

## Migration and validation

This setup creates a fresh microsandbox; it does not stop, delete, or import data
from an existing Incus VM. Shared source and `.env` files are reused, while guest
home files, authentication, and databases start fresh. Keep the old VM available
for any manual data recovery.

```bash
node --test scripts/init.test.mjs scripts/vm.test.mjs .vm/*.test.mjs
shellcheck -S warning .vm/*.sh scripts/vm.sh scripts/start-dependencies.sh .devcontainer/shell-aliases.sh
```

Live validation: run setup, check default-root capacity and Docker's ext4 storage,
verify shared writes/ownership and Git operations from primary/nested/external
worktrees, connect through SSH/SFTP/Orca/VS Code, and run frontend/API with an
email and upload. Verify guest data and shared work survive restart and setup
reruns. Verify removing a disposable sandbox retains its host files.
