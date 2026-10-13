# Open Collective development sandbox

[microsandbox](https://docs.microsandbox.dev) runs the development tools, Docker,
and databases in a persistent microVM. The primary host checkout is shared
read-write at `/workspace`, including service repositories, worktrees, `.env`
files, and `node_modules`. Guest edits and dependency installation affect the
same files on the host.

## Setup

Use a Linux host with KVM, microsandbox **v0.7.8 or newer**, Git, Bash, and jq.
OpenSSH is optional for editors and SFTP; Node.js is installed inside the guest.
Install the CLI using the
[official installation instructions](https://docs.microsandbox.dev/getting-started/quickstart).
Your regular user needs read/write access to `/dev/kvm`. Run setup without `sudo`.

Use the **primary monorepo checkout**, containing the API, frontend, REST, PDF,
images, and taxes:

```bash
MSB_BACKEND=local msb doctor
./.vm/setup.sh
```

Setup creates `oc-dev` using [opencollective-msb.yaml](opencollective-msb.yaml),
installs tools inside it, and initializes the existing PostgreSQL, Mailpit, and
RustFS Compose stack. It installs project packages and prepares development and
test databases. No host Docker or Node.js is needed. Prepare missing service
repositories on the host before setup. `./scripts/vm.sh setup` remains a
compatibility entry point.

The script resolves its checkout independently of your current directory and
rejects setup scripts in monorepo worktrees. It shares the primary checkout at
`/workspace` and its original absolute path, keeping nested worktree Git backlinks
valid without rewriting Git metadata. A mount that would hide checkout files is
rejected. Keep host paths stable. External worktrees and Git metadata outside this
checkout need manual mounts; see below.

Rerunning setup refreshes tools and preserves existing `.env` values and databases.
If a stage fails, its sandbox is retained so you can inspect it, fix the cause, and
rerun setup. Existing sandboxes are checked for workspace ownership, required
writable mounts, the owned Docker disk, guest runtime, and pending configuration
changes before provisioning. Their saved resources, ports, and extra mounts are
retained. Paused or transitional sandboxes must be resolved with native commands
before setup.

## Environment overrides

The YAML contains the image, CPU/RAM defaults, init, user, working directory,
workspace mount, networking, and published ports. It is loaded explicitly with
`msb create --conf`; Microsandbox does not discover config files automatically.
Set overrides when running setup:

```bash
OC_VM_CPUS=4 OC_VM_MEMORY_MB=16384 OC_VM_DISK_GB=50 ./.vm/setup.sh
```

| Variable              | Default                                        | Purpose                   |
| --------------------- | ---------------------------------------------- | ------------------------- |
| `OC_VM_CPUS`          | `8`                                            | Virtual CPUs              |
| `OC_VM_MEMORY_MB`     | `32768`                                        | RAM in MiB (32 GiB)       |
| `OC_VM_DISK_GB`       | `100`                                          | Docker data disk in GiB   |
| `OC_VM_INSTANCE_NAME` | `oc-dev`                                       | Sandbox name              |
| `OC_VM_IMAGE`         | `ghcr.io/superradcompany/ubuntu-systemd:24.04` | Ubuntu image with systemd |

The script supplies `OC_VM_WORKSPACE` (its primary checkout's absolute path) and
the default disk size for the YAML's `${NAME}` substitutions. YAML does not
support `${NAME:-fallback}` or numeric CPU interpolation. CPU, memory, and image
overrides therefore use native CLI flags. The sandbox name, original-path mount,
and owned Docker disk are supplied by the script; msb v0.7.8 cannot declare owned
disks in sandbox YAML.

`OC_VM_DISK_GB` also sets the additional guest-write allowance for each shared
host directory. It does not reserve that space on the host.

These settings apply at creation. Rerunning setup reuses the saved configuration;
it does not resize an existing VM, including one created with the former 42 GiB
RAM default. Use native `msb modify oc-dev --memory 32G` to change its memory.
For mount/image/port changes, use a
different sandbox name or explicitly remove the old sandbox after saving guest data.
The setup helper never replaces a sandbox automatically.

The helper selects `MSB_BACKEND=local` and verifies the effective backend;
managed policies can override that selection. `MSB_HOME` and `MSB_CONFIG_PATH`
are honored. Keep the same values for native administration commands and manual
SSH configuration; absolute paths are recommended. Setup does not modify
microsandbox's global configuration.

## External worktrees

Setup does not discover or add external mounts. Before creating a sandbox, use
`git worktree list --porcelain` and
`git rev-parse --path-format=absolute --git-common-dir` in each relevant repository
to identify paths outside the shared checkout. For each such path, add a bind to
the YAML using the same absolute host and guest paths:

```yaml
mounts:
  - "${OC_VM_WORKSPACE}:/workspace:uid=1000,gid=1000,quota=${OC_VM_DISK_GB}G"
  - "/absolute/external/worktree:/absolute/external/worktree:uid=1000,gid=1000,quota=${OC_VM_DISK_GB}G"
```

Retain the existing workspace mount. This also covers external common Git
directories or submodule worktrees whose metadata points outside the checkout.
Rerunning setup keeps additional mounts already saved in an existing sandbox.
Editing YAML does not add mounts to an existing sandbox; use a new name or save
guest data before explicitly removing and recreating it.

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

For a terminal, use native SSH without authorizing a key or configuring OpenSSH:

```bash
MSB_BACKEND=local msb ssh oc-dev --no-inactivity-timeout
```

For editors, OpenSSH, or SFTP, authorize a public key manually. Existing keys and
SSH entries from the previous setup still work; setup no longer writes them.
For a dedicated key, create it only if you do not already have the pair:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/oc-dev_ed25519 -C oc-microsandbox
```

Authorize its public key (or substitute another `.pub` path):

```bash
OC_VM_SSH_KEY="$HOME/.ssh/oc-dev_ed25519.pub"
MSB_BACKEND=local msb ssh authorize --file "$OC_VM_SSH_KEY"
```

`OC_VM_SSH_KEY` is a convenience for this manual command, not a setup override.
Add this entry to `~/.ssh/config`, adjusting the sandbox name and `IdentityFile`
when needed:

```sshconfig
Host oc-dev
  HostName microsandbox
  User ubuntu
  IdentityFile ~/.ssh/oc-dev_ed25519
  IdentitiesOnly yes
  ForwardAgent no
  ForwardX11 no
  StrictHostKeyChecking accept-new
  HostKeyAlias oc-dev-microsandbox
  UserKnownHostsFile ~/.ssh/oc-microsandbox-known_hosts
  ProxyCommand env MSB_BACKEND=local msb ssh serve oc-dev --stdio --no-inactivity-timeout
  ServerAliveInterval 30
  ServerAliveCountMax 3
```

For custom `MSB_HOME` or `MSB_CONFIG_PATH`, add the corresponding absolute-path
assignments after `env` in the ProxyCommand. The editor must be able to find `msb`
on its host PATH; use its absolute executable path if necessary. Never copy a
private key into the guest.

```bash
ssh oc-dev
ssh oc-dev node --version
sftp oc-dev
```

[microsandbox SSH](https://docs.microsandbox.dev/sandboxes/ssh) serves OpenSSH through
`ProxyCommand msb ssh serve oc-dev --stdio`, using `msb ssh authorize` for public
key authorization. There is no guest SSH daemon or persistent host SSH listener.
Authorization is shared across the selected `MSB_HOME`. Host keys use the separate
microsandbox known-hosts file configured above. Recreating a
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

To refresh just the toolchain, use the primary checkout's provisioning script:

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

Existing compatible microsandboxes are reused without changing their resources
or deleting guest data. Setup no longer installs SSH aliases or discovers external
worktrees. Keep existing SSH entries, or follow the manual instructions above.

This setup does not stop, delete, or import data from an existing Incus VM. A new
microsandbox reuses shared source and `.env` files, while guest home files,
authentication, and databases start fresh. Keep the old VM available for manual
data recovery.

```bash
node --test scripts/init.test.mjs scripts/vm.test.mjs .vm/*.test.mjs
shellcheck -S warning .vm/*.sh scripts/vm.sh scripts/start-dependencies.sh .devcontainer/shell-aliases.sh
```

Live validation: run setup, check default-root capacity and Docker's ext4 storage,
verify shared writes/ownership and Git operations from primary/nested/external
worktrees, connect through SSH/SFTP/Orca/VS Code, and run frontend/API with an
email and upload. Verify guest data and shared work survive restart and setup
reruns. Verify removing a disposable sandbox retains its host files.
