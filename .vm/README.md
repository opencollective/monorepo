# Open Collective development VM

This setup gives you a dedicated Linux development machine on your computer. Your
repositories, dependencies, databases, Docker containers, and coding agents live
inside it. Orca and VS Code stay on your host and connect over SSH.

The first supported host is **Linux x86_64 with KVM/libvirt**. Defaults are **8 CPUs,
42 GiB RAM, and a 200 GiB virtual disk**. The disk grows as it is used; the full
capacity is not allocated immediately. Leave enough RAM and storage for your host.

## 1. Prepare your host

You need hardware virtualization enabled in your firmware, access to `/dev/kvm`,
Vagrant, the `vagrant-libvirt` provider, Node.js 20 or newer, and OpenSSH tools.
Node runs the VM administration helpers; Docker and application code run inside
the guest. Provisioning and administration use Bash and Node.js. The `Vagrantfile`
is the minimal DSL adapter required by Vagrant, with settings validated in Node.

### Clone the launcher and check prerequisites

Clone the workspace without initializing its submodules on the host:

```bash
git clone https://github.com/opencollective/monorepo.git
cd monorepo
./scripts/vm.sh doctor
```

The host checkout is the launcher. The working checkout is cloned independently
inside the VM at `/workspace`. The launcher folder is also synced to `/vagrant`
by default; set `share_host_folder` to `false` to disable that sharing.

The doctor checks installed commands, KVM access, Vagrant configuration, the
provider plugin, and access to `qemu:///system`. It does not boot a VM.

## 2. Customize resources if needed

Copy the example before starting the VM:

```bash
cp .vm/.vm.local.example.json .vm.local.json
```

Edit the JSON file. It is ignored by Git; personal settings never need a commit.
Environment variables override its values:

```bash
OC_VM_CPUS=4 OC_VM_MEMORY_MB=16384 vagrant up
```

| Setting             | Default                                          | Environment override      | Description                                                                                                                                           |
| ------------------- | ------------------------------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cpus`              | `8`                                              | `OC_VM_CPUS`              | Number of virtual CPUs assigned to the VM.                                                                                                            |
| `memory_mb`         | `43008` (42 GiB)                                 | `OC_VM_MEMORY_MB`         | VM RAM in MiB; reserve enough memory for your host as well.                                                                                           |
| `disk_gb`           | `200`                                            | `OC_VM_DISK_GB`           | Initial virtual disk capacity in GiB. Space is allocated as used; changing this does not resize an existing VM disk.                                  |
| `share_host_folder` | `true`                                           | `OC_VM_SHARE_HOST_FOLDER` | Sync the host launcher folder at `/vagrant`; set `false` to disable. JSON accepts `true`/`false`; the environment accepts the strings `true`/`false`. |
| `box`               | `bento/ubuntu-24.04`                             | `OC_VM_BOX`               | Vagrant base image. It must provide an amd64 libvirt build compatible with the Ubuntu 24.04 provisioner.                                              |
| `box_version`       | `202508.03.0`                                    | `OC_VM_BOX_VERSION`       | Exact base-image release to use when creating the VM.                                                                                                 |
| `storage_pool`      | `default`                                        | `OC_VM_STORAGE_POOL`      | Host libvirt storage pool in which to create the VM disk.                                                                                             |
| `network_name`      | `oc-development`                                 | `OC_VM_NETWORK_NAME`      | Name of the private libvirt NAT network used for VM management and outbound access.                                                                   |
| `network_address`   | `192.168.121.0/24`                               | `OC_VM_NETWORK_ADDRESS`   | Private IPv4 subnet for that network, in CIDR notation with a prefix from `/16` to `/28`. Choose one that does not overlap your other networks.       |
| `repo_url`          | `https://github.com/opencollective/monorepo.git` | `OC_VM_REPO_URL`          | HTTPS URL of the top-level repository cloned into `/workspace` on first provisioning. Embedded credentials are rejected.                              |
| `repo_ref`          | `main`                                           | `OC_VM_REPO_REF`          | Branch, tag, or commit to check out when creating the guest checkout. Reprovisioning does not change an existing checkout.                            |

Keep environment overrides consistent for later Vagrant commands, or persist them
in the local JSON file. Apply CPU/RAM changes with `vagrant reload`.

Choose disk capacity **before creation**. Provisioning expands both ordinary and
LVM root layouts to use the initial virtual disk. Changing `disk_gb` afterward
does not resize an existing libvirt volume; use a backed-up recreation for this
first version. [Libvirt disk configuration](https://vagrant-libvirt.github.io/vagrant-libvirt/configuration.html)

The box version is deliberately pinned: it has an amd64 libvirt build; the newer
`202510.26.0` catalog entry does not. Another box must have a libvirt build and use
Ubuntu 24.04 with a supported single-disk root layout. `.vm/versions.json` pins
Node to `24.21.0`; nvm and global npm tools use `latest`. Each provisioning run
resolves nvm’s latest stable release and installs the current npm package releases.
You can replace `latest` with an explicit nvm tag or npm package version if needed.
Run `vagrant provision` to refresh these tools. Signed apt repositories supply
current OS, Docker, Compose, and GitHub CLI packages. Project dependencies still
use each repository’s package manifests and lockfiles.

### Host-folder sharing

The host launcher folder is available at `/vagrant` by default. To disable
sharing, set `"share_host_folder": false` in `.vm.local.json`, then run
`vagrant up` for a new VM or `vagrant reload` for an existing one. You can also use
`OC_VM_SHARE_HOST_FOLDER=false vagrant up`; use `true` to enable sharing.

This enables Vagrant's normal synced folder for the directory containing the
Vagrantfile. `/workspace` remains the independent guest development checkout.
The sync implementation is selected by Vagrant and the provider according to
installed host support. With libvirt this may be NFS (bidirectional) or rsync
(host-to-guest copies); NFS requires host NFS tooling, while rsync updates can be
triggered with `vagrant rsync`.
[Libvirt synced-folder behavior](https://vagrant-libvirt.github.io/vagrant-libvirt/examples.html#synced-folders)

Enabling sharing exposes files in that host directory, including local untracked
files, to guest processes. With a bidirectional backend, guest changes also affect
the host files. Disable sharing when you want filesystem
isolation. Disabling a copy-based backend does not remove files already copied
into the guest.

## 3. Run guided setup

In an interactive **host terminal**, run:

```bash
./scripts/vm.sh setup
```

The wizard walks you through seven stages:

1. Check for an already loaded host SSH agent and ask whether you approve
   forwarding it to this VM. Without an available agent or your approval,
   forwarding stays disabled.
2. Run `vagrant up --provider=libvirt`, install the guest toolchain, clone the
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
stored as a boolean in the host launcher's ignored
`.vagrant/oc-ssh-settings.json`. Without that file, forwarding defaults to disabled.
The wizard asks again when rerun; ordinary SSH-config refreshes preserve the choice.

Without working forwarded authentication, public repositories are cloned over
HTTPS and the private security repository is skipped. Development still works,
but Git pushes need separately configured authentication. The closing summary
records those limitations; guest GitHub CLI login remains a separate optional step.
Existing checkouts, remote URLs, and branches are preserved. Public repositories
cloned through HTTPS keep their HTTPS remotes if you enable forwarding later;
choose an SSH remote yourself when you want to push through the forwarded agent.

`vagrant up` by itself performs noninteractive system provisioning and clones the
top-level repository. It deliberately does not prompt for credentials or clone
private submodules. Run the wizard afterward to complete setup. Provisioning
uploads explicit setup assets over SSH. The `share_host_folder` setting controls
the host launcher-folder sync described above.
The setup does not mount a host Docker socket or copy host credential stores.
[Vagrant synced folders](https://developer.hashicorp.com/vagrant/docs/synced-folders/basic_usage)

Logins remain inside the guest tool's credential store. Do not put tokens in
`.vm.local.json`, the Vagrantfile, or committed files. You can defer a login and use
the command printed in the wizard's closing summary later. If setup is interrupted,
rerun it: existing checkouts, branches, databases, and user configuration are kept.

Provisioning assets are also installed under `/opt/oc-vm`, so a launcher from a
feature branch can bootstrap the guest even before that branch is merged. To
develop changes to the workspace itself, set `repo_ref` to a published branch before
initial creation; host checkout changes are never copied into `/workspace`.

## 4. Connect with SSH, Orca, or VS Code

### One SSH target

The helper derives connection details from Vagrant rather than hard-coding an IP,
port, or login key:

```bash
./scripts/vm.sh ssh-config            # Print the generated entry
./scripts/vm.sh ssh-config --install  # Refresh the shared oc-dev entry
ssh oc-dev
```

It writes `~/.ssh/oc-development.conf` and adds an `Include` at the beginning of
`~/.ssh/config`, preserving your other entries. Keep `oc-dev` reserved for this VM.
Vagrant's generated login key authenticates the connection. Agent forwarding uses
your existing host agent only when approved during setup. Orca and VS Code must have access to
that host agent too. Starting them from a host session with the working
`SSH_AUTH_SOCK` is one way to provide it.
Use `./scripts/vm.sh ssh` if you prefer the launcher's standalone SSH config.
[Vagrant ssh-config](https://developer.hashicorp.com/vagrant/docs/cli/ssh_config)

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
vagrant halt               # Shut down; preserve files and disks
vagrant up                 # Start again
./scripts/vm.sh ssh-config --install
vagrant reload             # Reboot/apply CPU or RAM changes
vagrant provision          # Reapply system provisioning without resetting work
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

## Backup and recreate

**`vagrant destroy` deletes the guest disk**, including unpushed Git work, `.env`
files, agent login credentials, databases, and Docker volumes. The host launcher
and your host SSH keys remain. A base Vagrant box cache is not a backup.

Before destroying it, push development commits or export patches, copy any needed
guest files explicitly over SSH/SFTP, and dump local data if you want to keep it:

```bash
# Host terminal: explicit copies, not filesystem sharing
ssh oc-dev 'pg_dump -h 127.0.0.1 -U postgres -Fc opencollective_dvl' > development.pgsql
ssh oc-dev 'git -C /workspace/opencollective-api diff --binary' > api-working.patch
```

The patch example does not capture untracked files, staged changes, or unpushed
commits. Export those separately or use your normal Git backup workflow. Keep
credential backups private if you choose to make them; recreating and logging in
again is the default. To recreate after backing up:

```bash
vagrant destroy
./scripts/vm.sh setup
```

The regenerated VM has a new SSH host key. A mismatch is intentional only after
you rebuilt the machine. Verify its new fingerprint, then reset only this VM's
dedicated trust record:

```bash
./scripts/vm.sh ssh-config --install --reset-host-key
```

The helper prints the fingerprint through Vagrant and asks before clearing the
old record. It never disables host-key checking or clears your general
`~/.ssh/known_hosts`. Re-test/re-import the target in Orca if it cached a previous
address or key.

## Troubleshooting and validation

- **KVM permission denied:** enable hardware virtualization, confirm `/dev/kvm`
  exists, join the `kvm` group, and start a new login session.
- **Cannot connect to libvirt:** check `virsh -c qemu:///system list --all`, daemon
  sockets, user permissions, and the provider installation guide.
- **Network collision:** choose a private unused subnet in `.vm.local.json` before
  creation. Avoid your LAN, VPN, and Docker subnets. Changing the management
  network on an existing VM requires a deliberate network migration/recreation.
- **SSH Git access fails:** check `ssh-add -l` on the host and in the guest
  (these commands only list loaded identities). Confirm forwarding was approved,
  that the editor can access the host agent, and that GitHub recognizes an available
  identity with the required repository/SSO access. Without usable authentication,
  setup uses public HTTPS clones and reports pushes/private access as unavailable.
  SSH Git authentication does not authenticate `gh` API calls.
- **GitHub key prompts on first access:** compare the presented host fingerprint
  with [GitHub's published fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints).
- **Codex device login unavailable:** run `codex login` in the guest, and use a
  second host terminal with `ssh -N -L 127.0.0.1:1455:127.0.0.1:1455 oc-dev` for
  its browser callback. Follow the URL printed by Codex. Do not copy the host's
  existing authentication cache. [Codex authentication](https://developers.openai.com/codex/auth)
- **Dependency startup fails:** run `oc-dependencies` in the guest; inspect
  `docker ps -a`, `docker logs <container>`, disk space, and API `.env` endpoints.
- **Orca/VS Code cannot find Node or agents:** check
  `ssh oc-dev 'node --version && codex --version && opencode --version'`.
  Reprovision to restore the system PATH links.
- **Host port already in use:** stop its other forward/process, or deliberately
  adjust application URLs along with tunnel ports. Orca and VS Code need not both
  forward the same port simultaneously.

The private NAT network provides outbound Internet access without bridging the
VM onto your LAN. Services follow their application and Compose binding settings
and may be reachable from the host or other guests on that network. Use editor
port forwarding or SSH tunnels for browser access through `localhost`.

Repository automation checks configuration parsing, shell scripts, SSH quoting and
host-key policy, forwarding approval, HTTPS cloning without authentication, tool
version resolution, direct Compose startup, and preservation of existing work.
Run them without booting a VM:

```bash
node --test scripts/init.test.mjs scripts/vm.test.mjs .vm/*.test.mjs
shellcheck -S warning .vm/*.sh scripts/vm.sh scripts/start-dependencies.sh .devcontainer/shell-aliases.sh
```

For a live acceptance check on a KVM host: run setup from a fresh VM, connect through
both editors, test approved forwarding and the unauthenticated HTTPS fallback,
check the closing summary and CLI discovery, start frontend/API and
auxiliary services, sign in, check an email and an upload, and run representative
API/frontend tests. Add an uncommitted file and a database record, then verify that
halt/up, reload, and reprovision preserve them. Verify that the VM uses its private
NAT network and that editor port forwarding works. Record the actual
Vagrant/provider/Docker and installed tool versions when reporting live results.

### Adding another provider later

Guest scripts do not depend on libvirt device names. Add a separate provider block
with its resource and disk controls, choose a compatible box build, and preserve
configurable host-folder sharing and the dedicated SSH target with private NAT.
Validate its root-disk growth, optional folder syncing, and SSH behavior before
documenting it as supported. Virtiofs is not explicitly configured; adding it
requires its host daemon and shared-memory lifecycle configuration.
[Libvirt synced-folder options](https://vagrant-libvirt.github.io/vagrant-libvirt/examples.html)
