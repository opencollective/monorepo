# Open Collective development VM

A persistent **Ubuntu 24.04 virtual machine** runs your repositories, Docker,
databases and development tools. SSH, Orca and VS Code connect from your host.
The compatibility baseline is **Incus 6.23 on Linux x86_64 with KVM**;
compatible newer client/server releases are accepted.

Defaults: **8 CPUs, 42 GiB RAM and a 100 GiB virtual disk**. The default `dir` pool
uses a sparse disk file; reserve enough real storage for data and backups.
The launcher integrates with your existing local daemon and creates dedicated
resources. It does not initialize or reset your daemon.

## 1. Prepare your host

Use your installed Incus 6+ daemon, enabled hardware virtualization, `/dev/kvm`,
Node.js 20+ and OpenSSH tools (`ssh`, `ssh-keygen`, optional `ssh-add`). Host route
inspection needs `ip` from iproute2. The daemon must report QEMU support and your
regular host user must have administrative access to its local socket. See
[Incus installation](https://linuxcontainers.org/incus/docs/main/installing/)
for distribution-specific packages and permissions. Run without `sudo`, so
UID/GID and SSH state belong to you. Remote and clustered daemons are unsupported.

```bash
git clone https://github.com/opencollective/monorepo.git
cd monorepo
./scripts/vm.sh doctor
```

Do not initialize host submodules. The working checkout is cloned independently
at `/workspace` **inside the VM**. Doctor reads versions, daemon capabilities and
prerequisites; it creates no launcher resources or keys and changes no daemon
configuration. Run the launcher on the KVM host itself; this development container
has no access to that host's Incus daemon.

## 2. Configure the VM

```bash
cp .vm/.vm.local.example.json .vm/.vm.local.json
# Or supply environment overrides:
OC_VM_CPUS=4 OC_VM_MEMORY_MB=16384 ./scripts/vm.sh up
```

Precedence: `OC_VM_<UPPERCASE_SETTING>` environment variables, then ignored
`.vm/.vm.local.json`, then tracked defaults. Persist overrides or use the same environment
for subsequent commands. Removed `box` and `box_version` JSON settings are rejected.

| Setting             | Default                                          | Meaning                                                                            |
| ------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `provider`          | `incus/kvm`                                      | The virtualization provider to use. Only `incus/kvm` is supported.                 |
| `image`             | `images:ubuntu/24.04/cloud`                      | Remote alias or full fingerprint resolving to an amd64 VM image.                   |
| `project`           | `oc-development`                                 | Dedicated project; `default` is rejected.                                          |
| `instance_name`     | `oc-dev`                                         | VM name; the SSH alias remains `oc-dev`.                                           |
| `cpus`              | `8`                                              | Virtual CPUs.                                                                      |
| `memory_mb`         | `43008`                                          | RAM in MiB (42 GiB).                                                               |
| `disk_gb`           | `100`                                            | Root capacity in GiB; growth supported, shrinking rejected.                        |
| `share_host_folder` | `true`                                           | Writable launcher checkout at `/host-workspace`.                                   |
| `storage_pool`      | `oc-development`                                 | Dedicated `dir` pool by default; another name selects an existing VM-capable pool. |
| `network_name`      | `oc-development`                                 | Dedicated managed bridge in the default project; maximum 15 characters.            |
| `network_address`   | `192.168.121.0/24`                               | Private IPv4 subnet, /16 through /28; first usable address is the gateway.         |
| `repo_url`          | `https://github.com/opencollective/monorepo.git` | Public HTTPS checkout URL, without embedded credentials.                           |
| `repo_ref`          | `main`                                           | Initial branch, tag or commit; existing checkouts are preserved.                   |

For example, use `OC_VM_IMAGE`, `OC_VM_PROJECT` or `OC_VM_STORAGE_POOL`.
JSON sharing values are booleans; `OC_VM_SHARE_HOST_FOLDER` accepts `true`/`false`.

The bridge enables IPv4 DHCP/NAT with gateway `192.168.121.1/24` by default and
IPv6 disabled. The launcher checks host routes and Incus networks for subnet
overlap and refuses unrelated resources with matching names. Resources carry
`user.oc-vm.owner`, derived from the canonical launcher path, and reuse requires
compatible configuration. Keep this checkout at the same path. A second checkout
needs separate project/bridge names and an explicitly selected existing custom pool.
The daemon's default profiles are not used.

### Current image and reproducibility

Fresh creation resolves the **current** Ubuntu 24.04 cloud **amd64 VM** image,
copies its fingerprint into the dedicated project and configures cloud-init
before first boot. These are Incus project-built Ubuntu images, not Canonical-built
images. See [the image server](https://images.linuxcontainers.org/) and
[6.23 cloud-init support](https://github.com/lxc/incus/blob/v6.23.0/doc/cloud-init.md).

The full fingerprint and build serial are recorded in instance metadata, `status`
and the private host `image.json`. Floating aliases do not guarantee identical
base bytes across machines. Existing VMs keep their disks: `up` never resolves or
downloads their image again, even when the image server is unavailable. Initial
creation requires that server, unless you import a local image as described below.

`.vm/versions.json` pins Node to `24.21.0`; nvm/global npm tools use `latest`.
Reprovisioning resolves those releases again; explicit versions can replace `latest`.
Signed apt repositories supply OS, Docker and GitHub CLI packages. Project dependencies
use each service's manifests and lockfiles.

### Sharing and private host state

An Incus disk device shares the **launcher directory**, including untracked files,
at `/host-workspace`. Guest writes affect host files. `/workspace` stays independent.
Cloud-init creates `ubuntu` with your host UID/GID so ordinary shared files are
writable; provisioning verifies alignment. A mismatch requires inspection. The
launcher never recursively changes ownership of your host checkout.

Private login keys and approval state live outside the launcher at
`${XDG_STATE_HOME:-$HOME/.local/state}/opencollective-vm/<checkout-id>-<project>-<instance>/`.
Directories are mode 700 and private files mode 600. `XDG_STATE_HOME` must be absolute
and outside the launcher, including through symlinks. Preserve this state with VM
backups. A missing existing-VM key requires restoring state or deliberately recovering
guest access through Incus; it is not automatically regenerated.

Stop, change settings, then run `up` to apply CPU/RAM/sharing changes. Increasing
`disk_gb` while stopped expands the disk and triggers provisioning to grow its
partition/filesystem. Back up before disk changes. Pool/network/project changes
require a separate VM or manual migration; changing `image` does not rebuild a VM.

```bash
./scripts/vm.sh stop
# Edit .vm/.vm.local.json, then:
./scripts/vm.sh up
```

## 3. Run guided setup

In an interactive **host terminal**, run:

```bash
./scripts/vm.sh setup
```

The wizard walks you through seven stages:

1. Check for an already loaded host SSH agent and ask whether you approve
   forwarding it to this VM. Without an available agent or your approval,
   forwarding stays disabled.
2. Create/start the Incus VM with `./scripts/vm.sh up`, install the guest toolchain, clone the
   workspace, and install the `oc-dev` SSH entry.
3. Connect to the guest, configure Git identity, and initialize repositories.
   Working forwarded GitHub authentication uses SSH; otherwise public repositories
   use HTTPS. The private `opencollective-security` repository is initialized only
   when your forwarded identity has access.
4. Offer a guest GitHub CLI web login for GitHub API commands. This is separate
   from Git-over-SSH and requests the CLI's default `repo`, `read:org`, and `gist`
   permissions. You can defer it.
5. Offer a guest Codex device-code login.
6. Offer a guest OpenCode provider login.
7. Start dependencies, install packages, prepare local databases/uploads, and
   check the guest toolchain.

Setup uses your existing host agent, with no required key filename.
Approval allows **guest processes to authenticate using identities available
through your host agent**, including other identities it holds. The choice is
stored as a boolean in the private host state directory
described below, in `ssh-settings.json`. Without that file, forwarding defaults to disabled.
The wizard asks again when rerun; ordinary SSH-config refreshes preserve the choice.

Without working forwarded authentication, public repositories are cloned over
HTTPS and the private security repository is skipped. Development still works,
but Git pushes need separately configured authentication. The closing summary
records those limitations; guest GitHub CLI login remains a separate optional step.
Existing checkouts, remote URLs, and branches are preserved. Public repositories
cloned through HTTPS keep their HTTPS remotes if you enable forwarding later;
choose an SSH remote yourself when you want to push through the forwarded agent.

`./scripts/vm.sh up` by itself performs noninteractive system provisioning and clones the
top-level repository. It deliberately does not prompt for credentials or clone
private submodules. Run the wizard afterward to complete setup. Provisioning
uploads explicit setup assets with `incus file push` and runs them as root through
`incus exec`. The `share_host_folder` setting controls
the host launcher-folder sharing described above.
The setup does not mount a host Docker socket or copy host credential stores.
[Incus disk devices](https://github.com/lxc/incus/blob/v6.23.0/doc/reference/devices_disk.md)

Logins remain inside the guest tool's credential store. Do not put tokens in
`.vm/.vm.local.json`, cloud-init configuration, or committed files. You can defer a login and use
the command printed in the wizard's closing summary later. If setup is interrupted,
rerun it: existing checkouts, branches, databases, and user configuration are kept.

Provisioning assets are also installed under `/opt/oc-vm`, so a launcher from a
feature branch can bootstrap the guest even before that branch is merged. To
develop changes to the workspace itself, set `repo_ref` to a published branch before
initial creation; host checkout changes are never copied into `/workspace`.

## 4. Connect with SSH, Orca, or VS Code

### One SSH target

The helper derives connection details from the local Incus daemon rather than hard-coding an IP,
port, or login key:

```bash
./scripts/vm.sh ssh-config            # Print the generated entry
./scripts/vm.sh ssh-config --install  # Refresh the shared oc-dev entry
ssh oc-dev
```

It writes `~/.ssh/oc-development.conf` and adds an `Include` at the beginning of
`~/.ssh/config`, preserving your other entries. Keep `oc-dev` reserved for this VM.
A dedicated launcher-generated Ed25519 login key authenticates the connection. Agent forwarding uses
your existing host agent only when approved during setup. Orca and VS Code must have access to
that host agent too. Starting them from a host session with the working
`SSH_AUTH_SOCK` is one way to provide it.
Use `./scripts/vm.sh ssh` if you prefer the launcher's standalone SSH config.

Interactive SSH logins start in `/workspace`. This is configured by the guest's
shell startup hook and applies to `ssh oc-dev` and `./scripts/vm.sh ssh`.

### Orca

Install Orca on the host, then:

1. Open **Settings → SSH → Add Target**.
2. Use the OpenSSH config picker to select `oc-dev`.
3. Test and save the connection.
4. Add the remote folder `/workspace` as the workspace project location.
5. For changes to a service, add `/workspace/opencollective-api`,
   `/workspace/opencollective-frontend`, or another service as its own remote Orca
   project. Each service is a separate Git repository.
6. Create a workspace with **Run on → oc-dev**, then launch Codex or OpenCode there.

Orca installs its normal small SSH relay on first connection. You do not install
the Orca desktop app or run `orca serve` inside this VM. The guest already provides
Node and native build tools for the relay.
[Orca SSH documentation](https://www.onorca.dev/docs/ssh)

When creating service worktrees, use the repository's required worktree location
under `/workspace/.worktrees/<feature>/<repository>` where your Orca version allows
it. Do not create a worktree for the `/workspace` repository itself. Service
worktrees need their own `npm install` and local `.env`; initialize those inside
the VM. This phase uses one shared dependency stack and one set of application
ports, so concurrent worktrees do not yet have isolated runtime environments.

### VS Code Remote SSH

Install the **Remote - SSH** extension on your host. Run **Remote-SSH: Connect to
Host**, choose `oc-dev`, then open `/workspace` or a service worktree. Accept the
workspace's extension recommendations in the remote environment.

You can also use the host's VS Code launcher:

```bash
code --remote ssh-remote+oc-dev /workspace
```

Orca's **Open in → VS Code** uses the same SSH target to open its remote worktree.

## 5. Run development services

In a **guest terminal**:

```bash
cd /workspace
oc-dependencies                  # PostgreSQL, Mailpit, RustFS
run frontend api                 # Existing PM2 workflow
```

You can also run `run frontend api rest pdf images`. Taxes is a library. Other
repositories use their own README workflows. For a service worktree, run
`npm run dev` from that worktree instead of the monorepo's canonical `run` shortcut.
Only one process can use each standard port at a time.

The bootstrap reuses the API’s Compose definitions directly, including their
port bindings. Setup and `oc-dependencies` use the Compose project name
`oc-development`, so they reuse the same containers and volumes. Guest `.env`
defaults connect to services on localhost; existing values are never overwritten.
Automatic database and bucket setup uses your configured endpoints. Redis is not
required by the current devcontainer; the API supports running without configured
Redis. OpenSearch remains optional:

```bash
oc-dependencies db mail uploads search
```

Forward the ports you need through Orca's **Ports** tab or VS Code's **Ports** panel.
Use local port numbers matching the guest ports because application URLs use
`localhost`:

| Service                              | Port |
| ------------------------------------ | ---- |
| Frontend                             | 3000 |
| Images                               | 3001 |
| PDF                                  | 3002 |
| REST                                 | 3003 |
| API                                  | 3060 |
| Mailpit web inbox                    | 1080 |
| RustFS S3 endpoint (browser uploads) | 9000 |
| RustFS console                       | 9001 |
| PostgreSQL (optional host client)    | 5432 |

A plain SSH tunnel is another option; run this on the **host**:

```bash
ssh -N -L 127.0.0.1:3000:127.0.0.1:3000 \
  -L 127.0.0.1:3060:127.0.0.1:3060 \
  -L 127.0.0.1:1080:127.0.0.1:1080 \
  -L 127.0.0.1:9000:127.0.0.1:9000 oc-dev
```

Open http://localhost:3000 and sign in as `testuser+admin@opencollective.com`
(no password). Open http://localhost:1080 for the development inbox.

Normal test and quality commands run **inside the guest**:

```bash
cd /workspace
test opencollective-api/test/server/models/SocialLink.test.ts
cd opencollective-api
npm run type:check
npm run lint:check
npm run prettier:check
```

Use each service's `AGENTS.md` for its full checks. The guest has Node 24, npm 11,
nvm, Git/gh, build tools, PostgreSQL client 16, Docker/Compose/Buildx, Cypress
runtime libraries/Xvfb, PM2, formatting tools, Codex, and OpenCode. These commands
are also available through noninteractive SSH, without manually sourcing nvm.

## Daily use and persistence

From the **host launcher directory**:

```bash
./scripts/vm.sh up          # Start the VM and refresh oc-dev
ssh oc-dev
```

The VM and Docker start normally, but development application processes are started
explicitly with `run`. Use `oc-dependencies` after boot to ensure the dependency
containers are running. Docker access is guest-local and grants administrative
access to that VM; its remote TCP API is disabled.

```bash
./scripts/vm.sh stop       # Shut down; preserve files and disks
./scripts/vm.sh up         # Start again and refresh the SSH alias
./scripts/vm.sh restart    # Reboot and refresh the SSH alias
./scripts/vm.sh status     # State, provisioning marker and image provenance
./scripts/vm.sh provision  # Reapply system provisioning without resetting work
./scripts/vm.sh retry-cloud-init # Recover failed initial cloud-init after repairing its cause
./scripts/vm.sh repair-ssh # Repair guest SSH configuration through the Incus agent
```

To change the forwarding choice without repeating the whole wizard, run:

```bash
./scripts/vm.sh ssh-forwarding        # Inspect the existing agent and ask approval
./scripts/vm.sh ssh-config --install  # Apply the choice to the shared target
```

Reconnect SSH, Orca, and VS Code after changing that choice. Existing connections
retain their forwarding behavior until closed. Agent availability and key lifetime
are managed by your existing host session or keychain. Forwarding disappears when
the SSH connection closes, even if Orca keeps remote processes alive.

Reprovisioning does not fetch/switch existing project checkouts or reset databases.
To update repositories, explicitly run `./scripts/init.sh` inside `/workspace`;
its documented branch-switching behavior still applies. Without private access,
select public repositories with `--projects api,frontend,rest,pdf,images,taxes`
so the update does not attempt the security repository. Rerunning the wizard
initializes missing repositories only. Package installation can apply pending
development migrations through the API's existing postinstall script.

This VM is a single persistent development machine. Docker is ready to host future
disposable per-workspace environments; no `environmentRecipes`, lifecycle scripts,
container workspace manager, or guest Orca server is installed in this phase.

## Backups, snapshots and recreation

Commands below work with Incus 6.23. Substitute configured resource names if you
changed defaults. Full exports can include credentials; keep them private.

**Stop the VM before a consistent full backup**, so databases and filesystems are
not changing. A portable export uses the default archive format, without
`--optimized-storage` (which depends on the original storage backend).

```bash
./scripts/vm.sh stop
incus --force-local --project oc-development export local:oc-dev ./oc-dev-backup.tar.gz
./scripts/vm.sh up
```

Back up private host state too. External files shared at `/host-workspace` are
**not included** in instance exports or snapshots; back up the launcher separately.
A base image or snapshot on the same pool is not an independent backup.

To import, prepare the project/pool/bridge on the destination and use an unused
instance name. Restore the same launcher path, private state, resource settings
and UID/GID to retain launcher management. Exports preserve ownership/provenance
markers. A different launcher path or host user needs an explicit administrative
migration of ownership markers and the developer account; it is not automatically adopted.

```bash
# Configured resources exist; no instance with this name:
incus --force-local --project oc-development import local: ./oc-dev-backup.tar.gz oc-dev --storage oc-development
./scripts/vm.sh up
```

Snapshots provide rollback on the same pool. Stop first for consistency. Restore
replaces guest changes since the snapshot, including checkout, database and
credential changes.

```bash
./scripts/vm.sh stop
incus --force-local --project oc-development snapshot create local:oc-dev before-change
incus --force-local --project oc-development snapshot list local:oc-dev
./scripts/vm.sh up
# To roll back later, first stop again:
incus --force-local --project oc-development snapshot restore local:oc-dev before-change
incus --force-local --project oc-development snapshot delete local:oc-dev before-change
```

### Delete and recreate

**Deletion removes the guest disk, snapshots, unpushed work, databases and guest
credentials.** Back up first. Reprovisioning reapplies packages/tools while preserving
checkouts, Docker volumes and credential stores.

```bash
./scripts/vm.sh destroy
```

`destroy` deletes the launcher-owned VM (including disks and snapshots), the
project and its remaining contents (such as its copied base image), bridge, and
dedicated `oc-development` storage pool. It also removes this
launcher's SSH include and known-hosts file, login key, and private approval/state
files. A configured existing `storage_pool` is shared and is preserved. The host
checkout and its files are not removed. Back up anything needed from the guest
first; after destruction, run `./scripts/vm.sh setup` to create a fresh VM and
SSH identity.

After `destroy`, setup generates a new host login key, and the old dedicated
known-hosts file is gone. If you manually delete and recreate only the Incus VM,
the host key and SSH trust state remain; run
`./scripts/vm.sh ssh-config --install --reset-host-key` to review its fingerprint
and clear the old `oc-dev` record. General `known_hosts` entries remain intact.

`destroy` checks Incus ownership markers before deleting named resources. If a
resource name now belongs to something else, it stops before making changes so
you can resolve the collision manually.

### Offline image export/import

While online, export the full fingerprint shown by `status`. In 6.23 an explicit
file prefix for a split VM image creates metadata and a `.root` disk file:

```bash
# Replace the placeholder with the complete fingerprint from status:
incus --force-local --project oc-development image export local:<fingerprint> ./ubuntu-24.04-cloud --vm
```

Copy **both** files to the offline host. After its dedicated project exists:

```bash
incus --force-local --project oc-development image import ./ubuntu-24.04-cloud ./ubuntu-24.04-cloud.root --alias ubuntu-24.04-offline
OC_VM_IMAGE=local:ubuntu-24.04-offline ./scripts/vm.sh up
```

On an empty daemon, manually prepare launcher-compatible resources first. Obtain
the owner value with:

```bash
node --input-type=module -e 'import {launcherIdentity} from "./.vm/state.mjs"; console.log(launcherIdentity(process.cwd()))'
```

For an empty daemon using the default names, with the subnet checked for conflicts:

```bash
oc_vm_owner=$(node --input-type=module -e 'import {launcherIdentity} from "./.vm/state.mjs"; console.log(launcherIdentity(process.cwd()))')
incus --force-local --project default storage create local:oc-development dir "user.oc-vm.owner=$oc_vm_owner"
incus --force-local --project default network create local:oc-development \
  "user.oc-vm.owner=$oc_vm_owner" ipv4.address=192.168.121.1/24 \
  ipv4.nat=true ipv4.dhcp=true ipv6.address=none
incus --force-local project create local:oc-development \
  -c "user.oc-vm.owner=$oc_vm_owner" -c features.images=true \
  -c features.profiles=true -c features.storage.volumes=true -c features.networks=false
```

Then run the image import above. Alternatively reuse resources from a prior
installation. System provisioning and
cloning still require apt/npm/Git endpoints or separately prepared caches; saving
a base image only removes the upstream image-server dependency.

## Troubleshooting

- **Prerequisites:** run `doctor`, `incus --force-local version local:` and
  `incus --force-local info local:`. Check the local socket, `/dev/kvm`, daemon QEMU
  packages and regular-user permissions.
- **Collision:** choose unused resource names/subnet. Avoid tagging unrelated
  resources as owned. NAT still lets host/other bridge guests reach services bound
  to guest addresses; use editor/SSH forwarding for browser access via localhost.
- **Agent/cloud-init:** failures retain the VM and name the stage. Inspect
  `incus --force-local --project oc-development console local:oc-dev`, or
  `incus --force-local --project oc-development exec local:oc-dev -- cloud-init status --long`
  once the agent responds. The launcher prints detailed cloud-init status and the
  tails of `/var/log/cloud-init-output.log` and `/var/log/cloud-init.log` on failure,
  including a timeout. Repair the reported cause before retrying `up`; retrying the
  launcher does not clear cloud-init's saved errors or rerun its completed modules.
  Agent readiness allows 180 seconds; cloud-init waits up to 10 minutes.
- **Guest DNS/networking:** `Temporary failure resolving archive.ubuntu.com`
  means the guest cannot resolve the Ubuntu package servers. Cloud-init failure
  diagnostics include guest addresses, IPv4 routes, resolver configuration and a
  bounded DNS lookup. Check that the guest received an address on the configured
  subnet, a default route through the bridge and a reachable DNS server. Also test
  DNS on the host. Host firewall rules must allow guest DHCP/DNS traffic to the
  bridge and guest traffic forwarded to the internet. Docker on the Incus host can
  set a `FORWARD` policy that blocks Incus traffic; see the
  [Incus firewall guide](https://linuxcontainers.org/incus/docs/main/howto/network_bridge_firewalld/)
  for UFW, firewalld and Docker remedies. Apply the remedy for the host's actual
  firewall; the launcher does not rewrite host firewall rules. Fix networking
  before retrying a failed package module; `up` alone does not clear its saved
  cloud-init error.

  With firewalld, a new bridge can inherit the host's default zone, which may
  reject DHCP even while Incus's dnsmasq is listening and Incus's own rules allow
  it. Assign the dedicated bridge to `trusted`, as described in the Incus guide:

  ```bash
  sudo firewall-cmd --zone=trusted --change-interface=oc-development
  sudo firewall-cmd --permanent --zone=trusted --change-interface=oc-development
  incus --force-local --project oc-development exec local:oc-dev -- networkctl renew enp5s0
  incus --force-local --project oc-development exec local:oc-dev -- timeout 30 bash -c \
    'until getent ahostsv4 archive.ubuntu.com; do sleep 1; done'
  ```

  Replace the bridge/project/instance names if configured differently. The first
  command applies the assignment immediately; the second persists it without
  reloading unrelated runtime firewall configuration. `trusted` permits guest
  access to host services. A host requiring tighter restrictions should use a
  dedicated zone/policy allowing DHCP, DNS and outbound forwarding instead.
  Remove this manual zone assignment when permanently deleting the bridge:

  ```bash
  sudo firewall-cmd --zone=trusted --remove-interface=oc-development
  sudo firewall-cmd --permanent --zone=trusted --remove-interface=oc-development
  ```

- **Recover a failed first boot:** after repairing networking, run
  `./scripts/vm.sh retry-cloud-init`. It accepts a completed cloud-init boot whose
  errors are limited to package installation, before system provisioning starts.
  It verifies DNS for the Ubuntu repositories, saves the old NoCloud user-data at
  `/var/lib/cloud/seed/nocloud-net/user-data.oc-vm-before-retry`, refreshes the
  launcher bootstrap configuration and reruns cloud-init using `cloud-init clean`
  followed by an Incus restart. The VM disks, machine ID, original boot logs,
  dedicated login key and SSH host keys are preserved. Cloud-init history/cache
  is reset; developer group creation is safe to repeat. A pending recovery marker
  lets `up` resume an interruption. Provisioning and SSH configuration follow only
  after cloud-init succeeds. Initialized VMs and unrelated cloud-init failures
  require targeted repair instead; use `provision` for ordinary tool updates.

- **Provisioning:** use `provision` to refresh tools; `up` retries incomplete setup.
  Completion is recorded only after success. Setup initializes missing repositories;
  package installation can apply the API's normal development migrations.
- **SSH/editors:** `ssh-config --install` discovers the current IP; `ssh`/`guest`
  refresh it automatically. Check `ssh oc-dev 'node --version'`. Provisioning never
  copies host SSH identities or credential stores.
  If the server logs `User ubuntu not allowed because account is locked` and
  `sshd -T` reports `usepam no`, run `./scripts/vm.sh repair-ssh`, then `ssh oc-dev`.
  Some cloud images omit openssh-server; cloud-init can create a minimal
  `sshd_config` before the package installs its Ubuntu defaults. The launcher
  explicitly enables PAM and public-key login, disables password and
  keyboard-interactive login, and supplies SFTP if absent. This policy runs on
  fresh creation and reprovisioning. Repair uses the Incus guest agent, preserves
  login/host keys and account password locks, and validates the configuration
  before reloading SSH. It backs up the original main config at
  `/etc/ssh/sshd_config.oc-vm-before`; validation failures restore the previous
  configuration. It does not rerun system provisioning or reset cloud-init.
- **Git:** inspect `ssh-add -l` on host/guest, forwarding approval and editor
  `SSH_AUTH_SOCK`. SSH Git and `gh` API authentication are separate. HTTPS fallback
  preserves existing remotes and skips unavailable private repositories. Verify
  initial GitHub keys against [GitHub's fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints).
- **Dependencies:** inspect `docker ps -a`, container logs, disk space and `.env`.
  Run `oc-dependencies` in the guest. Resolve occupied forwarding ports by stopping
  the other tunnel/process or changing both ports and application URLs.

## Validation

Offline checks cover configuration, 6.23 command ordering/project selection,
resource/subnet collisions, interrupted setup, retries, existing-VM image server
independence, SSH policy and the existing development flows:

```bash
node --test scripts/init.test.mjs scripts/vm.test.mjs .vm/*.test.mjs
shellcheck -S warning .vm/*.sh scripts/vm.sh scripts/start-dependencies.sh .devcontainer/shell-aliases.sh
```

**Live acceptance remains for your Incus 6.23 KVM host.** This Docker workspace has
neither Incus nor `/dev/kvm`. Simulated tests do not validate guest boot, sharing,
cloud-init or Docker runtime behavior. Record `incus version local:`, image
fingerprint/serial and installed tools with your results.

1. Run `doctor`; verify no project/pool/bridge/key is created. Run fresh `setup`;
   confirm type `virtual-machine`, successful cloud-init and working Docker/tools.
2. Connect with SSH, Orca and VS Code. Test forwarding approval/refusal and HTTPS
   fallback. Run frontend/API, forward ports, sign in, test an email and upload.
3. Write a harmless `/host-workspace` file as `ubuntu`, checking host content and
   UID/GID. Stop, disable sharing, `up`, verify device/mount absence; re-enable.
4. Add an uncommitted file, database record and guest credential. Verify persistence
   across `stop`/`up`, `restart` and `provision`, including branches and remotes.
5. Stop the existing VM; run `OC_VM_IMAGE=missing:ubuntu/24.04/cloud ./scripts/vm.sh up`.
   It must start without contacting that unavailable image remote. Restore normal
   settings afterward.
6. Test a stopped snapshot and portable export/import on a disposable copy,
   checking data and SSH trust; back up external shared files separately.
