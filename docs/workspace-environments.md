# Isolated Orca workspace environments

Each Orca workspace gets a disposable Ubuntu VM with its own public repository
checkout, Docker daemon, services, database fixtures, upload buckets, network and
SSH identity. Multiple agents in the same workspace share that VM. Bash and `jq`
handle lifecycle operations; `.env.workspace.local` selects the backend and
development settings. Existing local development and devcontainers are unaffected.

## Activate on the actual Linux host

Install Incus with VM support, QEMU/KVM, LVM2, `nftables`, `iproute2`, `jq`, Git,
OpenSSH, curl and Node.js (for the smoke test). The Orca desktop app and Incus must
run on the same host. The host user needs access to `/dev/kvm`, the local Incus
socket, and sudo for the root-owned firewall installation and storage reporting.
Incus socket access is host administration authority; never expose it to guests.
Install the `orca-ide` CLI shipped with your Orca version. No host Docker is needed.

```bash
cp .env.workspace.example .env.workspace.local
# Edit literal settings and absolute credential paths before continuing.
# Check wiring and prerequisites before allocating any VM or storage.
./scripts/workspace/workspace.sh doctor "$PWD"
./scripts/workspace/workspace.sh host-check
./scripts/workspace/workspace.sh setup
./scripts/workspace/workspace.sh install
./scripts/workspace/build-golden-image.sh
# The monorepo already declares workspace-vm in orca.yaml.

# Use a known live LAN/VPN endpoint; the smoke checks host reachability first.
WORKSPACE_SMOKE_LAN_IP=192.168.1.10 WORKSPACE_SMOKE_LAN_PORT=22 \
  ./scripts/workspace/workspace.sh smoke
```

Activation requires successful real-host KVM, storage, network, capacity and smoke
checks. This implementation was developed without Incus/KVM access; unit tests
exercise a fake provider and do not establish actual isolation or hibernation.
Do not treat a successful recipe doctor as a VM acceptance test.

The default concurrency needs **160 GiB for ten running guests**, plus host
overhead. Building an image alongside those guests needs another **16 GiB**.
`host-check` requires 184 GiB total for the default configuration (176 GiB guests
plus an 8 GiB minimum host reservation). Leave more overhead for other host work.
CPU scheduling can overcommit physical cores; the project caps allocated vCPUs.
Before setup, lower workspace count/resources if the actual machine cannot meet
these requirements. `setup` refuses an overlapping subnet or insufficient RAM.
Incus/QEMU and the host filesystem must support stateful stop and discard.

## Configuration

Files contain `KEY=value`, optional surrounding single/double quotes, blank lines
and full-line comments. Values are literal: no `export`, interpolation, command
substitution, inline comments or shell evaluation. Unknown keys fail. Later file
entries override earlier ones; already-set environment variables override the file.
Empty state/install directories select defaults under the host user's home.
`--config /absolute/path/env` selects a different file on either entry point:

```bash
./scripts/workspace/workspace.sh --config /home/me/dev-workspace.env setup
./scripts/workspace/build-golden-image.sh --config /home/me/dev-workspace.env
```

| Setting                            | Default                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------- |
| Backend / guest                    | Incus / Ubuntu 24.04 cloud                                                  |
| Public projects                    | opencollective, API, frontend, documentation, images, PDF, REST, taxes, RSS |
| Running application services       | API, frontend                                                               |
| Dependency services                | PostgreSQL, Mailpit, RustFS                                                 |
| Agent tools                        | Codex, OpenCode                                                             |
| Node / npm                         | 24 / 11                                                                     |
| Workspaces / reserved builder slot | 10 / 1                                                                      |
| Per-VM CPU / RAM                   | 4 vCPUs / 16 GiB                                                            |
| Root disk / state disk             | 100 GiB / 20 GiB                                                            |
| Project ceilings                   | 11 VMs, 44 vCPUs, 176 GiB RAM, 2 TiB logical disk                           |
| Sparse LVM file ceiling            | 512 GiB                                                                     |
| Network bandwidth                  | 100 Mbit/s per VM                                                           |

`WORKSPACE_PROJECTS` controls public checkout/dependency caches. Private security
is excluded and cannot be selected by this implementation. `WORKSPACE_SERVICES`
can also include `images,pdf,rest`; each must be selected as a project.
`WORKSPACE_DEPENDENCY_SERVICES` optionally includes `search`. Dependency Compose
files come from the API project, so that project must be selected. Running API
requires `db`. Empty service/tool lists are supported. Resources live in the Incus
profile, separately from the image. Rerun `setup` to apply changed resource settings;
changing profiles of running or suspended VMs can require stopping them and can
invalidate memory snapshots. Change resource settings between workspace sessions.
Image-content settings require rebuilding the golden image. Live workspaces retain
their installed tooling until replaced; resume never refreshes repositories.

## Prepare dedicated credentials

Credentials are optional. Use dedicated development accounts/tokens, prepared by
logging in locally with the corresponding CLI. Copy only the required credential
files into a private host directory and set mode 600. Set the literal JSON map:

```dotenv
WORKSPACE_CREDENTIAL_FILES={"/home/me/dev-auth/codex.json":".codex/auth.json","/home/me/dev-auth/opencode.json":".local/share/opencode/auth.json","/home/me/dev-auth/gh-hosts.yml":".config/gh/hosts.yml"}
```

Only these destinations are supported. Inputs must be regular files owned by the
host user, without symlinks or group/other permissions. The builder never reads
these files. Create copies them through the provider channel after cloning;
GitHub CLI sets up guest-local Git authentication for branch fetching/pushing.
No SSH agent is forwarded. Credentials inside a VM are readable by its agents,
which have sudo in that guest. Remove access or destroy that VM when finished.
Destroy removes its managed host SSH/state files, not your selected credential
source files. Auth formats vary with CLI versions; verify your prepared files
with the installed versions. Tool version defaults resolve at build time and are
recorded in the image manifest; use explicit versions when you need repeatability.

## Golden images: build, refresh and rollback

```bash
./scripts/workspace/build-golden-image.sh          # Initial build or cached refresh
./scripts/workspace/build-golden-image.sh --rebuild # Fresh Ubuntu cloud OS
./scripts/workspace/workspace.sh rollback-image    # Swap active and previous
```

The same build command clones the last sanitized image when available. It updates
OS packages, public HTTPS checkouts, selected agent CLIs, Node/npm, PM2,
Docker/Compose, Git/GitHub CLI, PostgreSQL client and browser-test system libraries.
Repository `.nvmrc` files select numeric Node versions. npm/Cypress downloads,
installed dependencies and Docker image layers remain cached. A dependency
fingerprint includes manifests, lockfiles, `.npmrc`, `.nvmrc`, resolved Node/npm
versions and installation flags; unchanged installations reuse `node_modules`.
API postinstall/database work is postponed to the fresh workspace.

`/opt/oc-workspace/image-manifest.json` records commits, resolved tool and Node
versions, Docker digests and dependency fingerprints. Sanitation removes SSH keys
and authorization, machine IDs, cloud-init state, random seeds, credentials,
history/logs, containers/volumes and agent/Orca runtime state. Public committed
development `.env.local` files are retained. No host source checkout is imported.

A private versioned candidate is published, the builder is deleted, and a clone of
that candidate boots and initializes the actual fixture databases/buckets/services.
Only successful validation changes the active alias. The preceding image remains
under `<image>-previous` for rollback, and versioned candidates remain for explicit
inspection/removal. Failed refreshes delete the candidate and leave the active
alias unchanged. Existing workspaces are independent and unaffected. Builds are
serialized; traps clean builders on normal errors/interrupts. A host crash or
SIGKILL can leave an owned `builder` visible in `status`: inspect its ownership tags
and remove it explicitly with project-scoped Incus commands before rebuilding.

The build timeout is separately configurable (default two hours). Checkout/start
readiness defaults to 15 minutes. Cached refreshes still contact upstream sources
to resolve current versions and repository state.

## Orca and Remote-SSH

`install` copies trusted lifecycle code and effective configuration outside agent
checkouts (default `~/.local/lib/oc-workspace`) and prepends the managed SSH Include.
Do this again after updating scripts/config. The installed copy takes precedence
for recipes; changing a checkout does not change an already-registered lifecycle.
Protect the installation/state directories from agents; they are host-local and
are never mounted into guests.

The monorepo's tracked `orca.yaml` declares the `workspace-vm` recipe with
`checkoutMode: provisioned-root`. Its portable `recipe.sh` entry point reads the
local configuration only to locate the installed host dispatcher, then delegates
create, suspend, resume and destroy without changing stdin or checkout context.
Run `install` before using the recipe; no VM operation runs from the checkout.

For service projects, `register-project "$PWD/opencollective-api"` writes a local
`orca.yaml` pointing directly at the installed dispatcher and adds `/orca.yaml`
to that service's Git exclude. Existing recipes are left for manual merging.
The Orca composer reads recipes from the primary checkout/branch: a recipe only
on this feature branch will not appear in the primary project's Run on picker.
Make the recipe available there before using the picker; the static doctor can
check this branch before then. All lifecycle progress goes to stderr;
create/resume emit a single schema-version-2 SSH result. Create rejects a missing
or unsupported `ORCA_RECIPE_RESULT_SCHEMA_VERSION` before allocating a VM;
resume requires a saved version-2 provisioned-root result.

Create verifies Orca's pinned branch/commit, selects the monorepo or configured
service root, refreshes repositories, prepares that checkout, conditionally
installs dependencies, initializes fresh fixtures/buckets and starts services.
The guest verifies an ordinary, non-bare, non-sparse primary checkout at the
requested branch and exact pinned commit; no linked worktree or host source mount
is used. Each VM receives a distinct host-side Ed25519 key, `oc-orca-...` SSH alias,
and guest host key obtained through Incus exec. Effective SSH configuration must
disable agent forwarding and require strict host-key checking. If a preceding
`Host *` overrides the Include, fix its order before creating a workspace.

Connect with `ssh oc-orca-...`, or select that alias in VS Code's **Remote-SSH:
Connect to Host** command. Forward only the guest ports you need:

```bash
ssh -N -L 3000:127.0.0.1:3000 -L 3060:127.0.0.1:3060 oc-orca-...
# Inside the guest/service checkout, with guest-local GitHub credentials:
gh pr checkout 123
```

Compose publishes dependencies on guest loopback. Managed Node services use a small
preload to bind default/wildcard TCP listeners to loopback, preserving Unix sockets.
API, frontend, Postgres, Mailpit and RustFS use guest-local endpoints. RustFS uses
its actual `user/password` S3 settings, replacing the devcontainer's MinIO mismatch.
Secrets for local sessions/JWT are generated per workspace. Use PM2 in the guest
to inspect/restart application processes; containers use Compose project
`oc-workspace` and `/opt/oc-workspace/compose.json`. Resume restores memory,
processes, uncommitted changes and databases, keeping the SSH identity and root;
it performs no checkout/reset/reinstall. Stateful-stop errors are returned without
a shutdown fallback. Destroy checks both the host registry and provider ownership.
Lifecycle retries are serialized per workspace. Manual recovery:

```bash
./scripts/workspace/workspace.sh status
./scripts/workspace/workspace.sh destroy orca-INSTANCE-ID
```

Doctor loads the installed `orca-per-workspace-env` guide and checks recipe wiring
without consulting Incus, creating state directories or provisioning a VM. It uses
`ORCA_CLI_COMMAND` when set, otherwise `orca-dev` in an `ORCA_DEV_REPO_ROOT` session,
otherwise `orca-ide` on Linux; it never falls through to the GNOME screen reader.
It preserves CLI errors and rejects both `fail` and `warn`, even when `ok:true`.
Inspect and resolve those checks before live validation. If Orca reports that it
is not running, start the same executable with `open --json` and retry. A
`runtime_access_denied` error requires fixing runtime access, not restarting Orca.

Orca doctor `--provision` exercises create/result validation/destroy and only sees
what the scripts print; it does not prove SSH connectivity. Provisioned-root also
needs the complete pinned checkout context; if your Orca build's doctor does not
provide it, use the dedicated smoke, which supplies that context. Smoke separately
dials the emitted SSH target, checks the pinned checkout and selected agent binaries,
and validates isolation and hibernation. Before reporting success, it verifies that
destroy removed both provider VMs and their managed SSH/state files.
After the host checks pass, exercise create, suspend/resume and destroy through
the actual Orca picker. No live host check has been run in this development environment.

The supplied Orca skill normally suggests an authenticated image layer. This
setup follows the explicitly requested credential-free golden-image policy instead:
only selected private development credential files are injected after VM creation.
There is no auth snapshot and no `orca serve` process in the image. Prepare those
files with the agent's interactive login in your own terminal; verify the selected
agent's login status and `gh auth status` inside a created VM without printing tokens.

## Networking and storage maintenance

Setup creates an owned restricted project, profile, NAT bridge and **one Incus-managed
sparse LVM pool file**, normally `/var/lib/incus/disks/orca-vms.img`. No physical
disk, host partition or existing volume group is accepted. Native thin snapshots
provide COW workspace creation after Incus prepares the image on that pool.
The first clone can take longer while Incus prepares its optimized image volume.
The 2 TiB logical quota counts virtual disks/images, whereas the sparse file's
512 GiB ceiling is the physical thin-pool capacity.

NIC port isolation and anti-spoofing combine with a persistent root-owned nftables
unit. Its own atomic table blocks guest-initiated host access, special-use IPs,
LAN/VPN routes, host public IPs and sibling guests. Guest IPv6 is disabled on the
bridge and blocked by the host policy. Public internet plus bridge DHCP/DNS is
permitted; only host-initiated SSH and connection replies reach guests. No host
mount, host Docker socket, Incus socket or SSH agent reaches the VM. Route-derived
rules refresh before create/resume/build; restart the firewall unit after changing
VPN/routes while VMs run. Other host firewall rules may still block permitted
traffic; smoke must pass with your real firewall and VPN configuration.

```bash
./scripts/workspace/workspace.sh status
./scripts/workspace/workspace.sh grow-pool 768
./scripts/workspace/workspace.sh trim
```

Status separately reports the logical disk budget, sparse file capacity, actual
allocated blocks, host filesystem free bytes, and thin data/metadata percentages.
Growth uses Incus to extend its loop file/PV/thin pool; keep sufficient host free
space and rerun status to confirm the new ceiling. Never truncate that file or
try to shrink the LVM pool. `trim` issues guest TRIM for running managed VMs.
Snapshots/clones can retain shared blocks; host allocation reclamation depends
on the actual loop/discard/filesystem stack. The smoke writes/removes 256 MiB of
unique guest data and requires a decrease in both thin usage and backing-file
allocation after TRIM. Validate growth with a deliberate `grow-pool` increase
on your host, or run `smoke --grow-pool 520` to verify a deliberate increase
from the default 512 GiB during acceptance. Data/metadata/free-space thresholds prevent new
allocations at 85% thin usage or less than 20 GiB host free space by default.
They are admission checks, not a live host-space reservation; monitor storage.
Inspect old versioned images before deleting them using project-scoped Incus;
keep the active and previous images. Host disks shared with other applications
can still fill after a VM starts.

## Add another backend

Add a trusted Bash adapter at `scripts/workspace/backends/<name>.sh`, selected
by `WORKSPACE_BACKEND`; unknown backends fail explicitly. Extend the central
configuration allowlist with prefixed provider settings. Do not put provider
commands or IDs in shared code. Implement this interface:

| Function                                                                           | Contract                                                                        |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `backend_check`, `backend_setup`, `backend_guard`                                  | Prerequisites, owned host configuration, admission checks                       |
| `backend_handle id role`                                                           | Opaque JSON identity tagged with installation owner and workspace/builder role  |
| `backend_assert handle`, `backend_workspace_count`                                 | Verify ownership and count managed workspace VMs                                |
| `backend_builder handle rebuild`                                                   | Cached golden clone, or clean configured OS                                     |
| `backend_create handle image`, `backend_start handle`                              | Idempotent VM allocation and readiness; restore saved memory on start           |
| `backend_suspend handle`, `backend_destroy handle`                                 | Save/release memory without fallback; destroy only owned resources              |
| `backend_exec handle user command...`                                              | Management-channel execution, stdout preserved; optional `BACKEND_EXEC_TIMEOUT` |
| `backend_push handle source destination user mode`                                 | File copy through management channel, ownership/mode enforced                   |
| `backend_address handle`                                                           | Reachable guest IPv4                                                            |
| `backend_publish handle candidate`                                                 | Stop and publish private sanitized image                                        |
| `backend_promote candidate`, `backend_image_discard candidate`, `backend_rollback` | Atomic activation with previous retention; owned image deletion/swap            |
| `backend_status`, `backend_grow gib`, `backend_trim`                               | Structured status and explicit maintenance                                      |

All operations must fail explicitly when unsupported. Shared code owns config,
credentials, identities, state locks, guest scripts and Orca output. Incus resource
identifiers are opaque provider metadata inside host records. A future VirtualBox
adapter needs equivalent isolation, trusted host-key retrieval, COW and stateful
suspend before it can satisfy this contract. The current acceptance smoke uses
Incus storage/network measurements; adapt that host test when adding a backend.

## Checks and reference contracts

`./scripts/workspace/check.sh` runs Bash syntax, ShellCheck, shfmt, Prettier,
Node syntax, native lifecycle tests and existing monorepo initialization tests.
It needs those check tools available on PATH. Fake-provider tests cover data-only
configuration, dispatch, ownership, retry identities, lifecycle JSON, cleanup,
credential selection, dependency invalidation and failed-refresh rollback.
No service repository is modified by this feature, so service type/lint suites
are outside this change. Actual VM services, KVM memory state, network packet
enforcement, storage COW/growth/discard and Orca integration remain host checks.

Reference the installed Orca version as the final contract authority:
[Orca SSH checkout contract](https://github.com/stablyai/orca/blob/main/skill-guides/orca-per-workspace-env/references/ssh-host.md),
[per-workspace recipes](https://www.onorca.dev/docs/ways-to-run),
[Incus project limits](https://linuxcontainers.org/incus/docs/main/reference/projects/),
[native storage optimization](https://linuxcontainers.org/incus/docs/main/reference/storage_drivers/),
[LVM storage](https://linuxcontainers.org/incus/docs/main/reference/storage_lvm/),
[stateful instance options](https://linuxcontainers.org/incus/docs/main/reference/instance_options/),
and [VS Code Remote-SSH](https://code.visualstudio.com/docs/remote/ssh).
