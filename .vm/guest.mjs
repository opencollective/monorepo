#!/usr/bin/env node
// Guest checkout/bootstrap operations; never reads host credentials.
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { command, isMain, main } from "./process.mjs";

// Read simple assignments for defaults; never source .env as
// shell code. This is deliberately not a general dotenv expansion engine.
function envValues(path) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const source of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = source.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const separator = line.indexOf("=");
    values[line.slice(0, separator).trim()] = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return values;
}

// A rerun may encounter deliberate developer overrides. Append missing keys
// only, including when an existing assignment uses `export KEY=value`.
export function writeEnvDefaults(path, defaults) {
  const existing = envValues(path);
  const additions = Object.entries(defaults).filter(
    ([key]) => !Object.hasOwn(existing, key),
  );
  if (additions.length) {
    appendFileSync(
      path,
      `\n# Local development VM defaults\n${additions.map(([key, value]) => `${key}=${value}\n`).join("")}`,
    );
    chmodSync(path, 0o600);
  }
}

// Provisioning invokes clone as ubuntu without an agent. The interactive host
// wizard invokes initialize/stack later over SSH, with optional agent forwarding.
// Injectable paths/process execution let tests avoid touching a real guest.
export function createGuest({
  root = "/workspace",
  assets = "/opt/oc-vm",
  configPath = "/etc/opencollective-vm.json",
  env = process.env,
  run = command,
  wait = sleep,
  output = console.log,
} = {}) {
  const execute = (args, options = {}) =>
    run(args, { cwd: root, env, ...options });

  function clone() {
    // Reprovisioning upgrades tooling, not working copies. Even a dirty checkout
    // or a custom current branch is left entirely under developer control.
    if (existsSync(join(root, ".git"))) {
      output(
        "Existing /workspace checkout preserved; no fetch, branch switch, or reset.",
      );
      return;
    }
    if (readdirSync(root).length)
      throw new Error(
        "/workspace is nonempty and is not a Git checkout; refusing to overwrite it",
      );
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    // Failed downloads/ref lookups leave /workspace empty and can be retried.
    const temporary = mkdtempSync(join(tmpdir(), "oc-vm-checkout-"));
    const checkout = join(temporary, "repository");
    try {
      execute(
        ["git", "clone", "--no-checkout", "--", config.repo_url, checkout],
        { cwd: temporary },
      );
      const ref = config.repo_ref;
      const branch = execute(
        [
          "git",
          "show-ref",
          "--verify",
          "--quiet",
          `refs/remotes/origin/${ref}`,
        ],
        { cwd: checkout, check: false },
      );
      // Branch refs become normal tracking branches; tags/commits stay detached
      // rather than inventing a local branch with a misleading upstream.
      if (branch.status === 0) {
        execute(["git", "checkout", "-B", ref, `origin/${ref}`], {
          cwd: checkout,
        });
        execute(["git", "branch", "--set-upstream-to", `origin/${ref}`, ref], {
          cwd: checkout,
        });
      } else {
        execute(["git", "fetch", "origin", ref], { cwd: checkout });
        execute(["git", "checkout", "--detach", "FETCH_HEAD"], {
          cwd: checkout,
        });
      }
      // Move .git last so an interrupted transfer is not mistaken for a complete
      // checkout on rerun. /tmp and /workspace may reside on different filesystems.
      for (const name of readdirSync(checkout).sort(
        (a, b) => Number(a === ".git") - Number(b === ".git"),
      )) {
        const source = join(checkout, name);
        const destination = join(root, name);
        try {
          renameSync(source, destination);
        } catch (error) {
          if (error.code !== "EXDEV") throw error;
          cpSync(source, destination, {
            recursive: true,
            dereference: false,
            verbatimSymlinks: true,
            errorOnExist: true,
            force: false,
          });
          rmSync(source, { recursive: true });
        }
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  function initialize() {
    if (!existsSync(join(root, ".gitmodules")))
      throw new Error(
        "Missing /workspace/.gitmodules; check that the guest checkout is complete",
      );
    // Inspect a forwarded agent without loading keys. Probe public GitHub SSH
    // access first: a loaded identity need not be registered with GitHub. Batch
    // mode avoids passphrase prompts; first-use host keys use OpenSSH's TOFU
    // policy while changed keys are still rejected.
    const gitEnv = {
      ...env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_SSH_COMMAND:
        "ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new",
    };
    const canRead = (url) =>
      execute(["git", "ls-remote", url, "HEAD"], {
        env: gitEnv,
        quiet: true,
        check: false,
      }).status === 0;
    let sshAuth = false;
    let privateAccess = false;
    if (env.SSH_AUTH_SOCK) {
      try {
        sshAuth =
          execute(["ssh-add", "-l"], { quiet: true, check: false }).status ===
            0 &&
          canRead("git@github.com:opencollective/opencollective-api.git");
        if (sshAuth)
          privateAccess = canRead(
            "git@github.com:opencollective/opencollective-security.git",
          );
      } catch {
        // Missing inspection tools or unusable authentication do not block public development.
      }
    }
    if (!sshAuth)
      output(
        "No working forwarded GitHub identity. Public repositories use HTTPS; Git pushes require separate authentication.",
      );
    if (!privateAccess)
      output(
        "Skipping private opencollective-security initialization: GitHub access is unavailable. Existing checkouts are preserved.",
      );

    // Let Git parse the service list. The security repository is the monorepo's
    // private module; failure to read it must not block the public application.
    const modules = execute(
      [
        "git",
        "config",
        "-f",
        ".gitmodules",
        "--get-regexp",
        String.raw`^submodule\..*\.path$`,
      ],
      { capture: true },
    ).stdout;
    const missing = modules
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        const [, key, path] = /^(\S+)\s+(.*)$/.exec(line);
        return existsSync(join(root, path, ".git"))
          ? []
          : [{ name: key.slice("submodule.".length, -".path".length), path }];
      });
    const selected = missing.filter(
      ({ path }) => path !== "opencollective-security" || privateAccess,
    );
    for (const { name } of selected) {
      const original = execute(
        [
          "git",
          "config",
          "-f",
          ".gitmodules",
          "--get",
          `submodule.${name}.url`,
        ],
        { capture: true },
      ).stdout.trim();
      const url = sshAuth
        ? original
        : original.replace(/^git@github\.com:/, "https://github.com/");
      if (!sshAuth && !url.startsWith("https://github.com/"))
        throw new Error(`Cannot use GitHub HTTPS fallback for ${name}`);
      // Override only new clones in the guest's local Git config. Submodule
      // cloning then uses the selected transport without editing .gitmodules
      // or changing any existing developer checkout's remote URL. Replacing a
      // URL left by a failed clone also makes retries honor current access.
      execute(["git", "config", "--local", `submodule.${name}.url`, url]);
    }
    // The shared init script updates selected repos to main. Select only missing
    // repos here so onboarding never switches an existing development branch.
    if (selected.length)
      execute(
        [
          "bash",
          join(assets, "shared/init.sh"),
          "--projects",
          selected.map(({ name }) => name).join(","),
        ],
        { env: { ...gitEnv, OC_MONOREPO_ROOT: root } },
      );
    else
      output(
        "All accessible repositories already initialized; branches and local work preserved.",
      );
    // This guest-local report lets the host wizard include deferred Git access
    // in its closing summary even if later optional login stages are completed.
    const reportDir = join(root, "priv");
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(
      join(reportDir, "vm-git-status.json"),
      JSON.stringify({
        ssh_auth: sshAuth,
        private_access: privateAccess,
      }) + "\n",
      { mode: 0o600 },
    );
  }

  function gitStatus() {
    const report = JSON.parse(
      readFileSync(join(root, "priv/vm-git-status.json"), "utf8"),
    );
    return !report.ssh_auth
      ? "https-public"
      : report.private_access
        ? "ssh-private"
        : "ssh-public";
  }

  async function stack() {
    // Reuse the monorepo's npm/Compose workflow. Optional tools and watch repos
    // are initialized too, but are not required to run the core application stack.
    const required = ["api", "frontend", "rest", "pdf", "images", "taxes"];
    for (const name of required) {
      if (!existsSync(join(root, `opencollective-${name}/package.json`)))
        throw new Error(
          `Missing ${name}; run the repository onboarding stage first`,
        );
    }
    const api = join(root, "opencollective-api");
    // Setup and oc-dependencies share this name so reruns reuse Docker volumes.
    const stackEnv = {
      ...env,
      OC_MONOREPO_ROOT: root,
      COMPOSE_PROJECT_NAME: "oc-development",
    };
    execute(
      [
        "bash",
        join(assets, "shared/start-dependencies.sh"),
        "--engine",
        "docker",
        "--detach",
        "db",
        "mail",
        "uploads",
      ],
      { env: stackEnv },
    );
    // Compose returning does not imply database readiness. npm postinstall needs
    // a working server, so bound the wait and stop before dependency installation.
    let postgresReady = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      if (
        execute(["pg_isready", "-h", "127.0.0.1", "-U", "postgres"], {
          check: false,
          quiet: true,
        }).status === 0
      ) {
        postgresReady = true;
        break;
      }
      await wait(2000);
    }
    if (!postgresReady)
      throw new Error(
        "PostgreSQL did not become ready; inspect docker compose logs",
      );
    // Services run directly in the VM, while dependencies run in Docker. Use VM
    // localhost instead of the devcontainer's Docker-network service hostnames.
    // The S3 credentials below belong only to the upstream local uploads fixture.
    writeEnvDefaults(join(api, ".env"), {
      PG_HOST: "127.0.0.1",
      MAILPIT_HOST: "127.0.0.1",
      AWS_S3_ENDPOINT: "http://127.0.0.1:9000",
      AWS_KEY: "user",
      AWS_SECRET: "password",
      AWS_S3_REGION: "us-east-1",
      AWS_S3_SSL_ENABLED: "false",
      AWS_S3_FORCE_PATH_STYLE: "true",
      IMAGES_URL: "http://localhost:3001",
      PDF_SERVICE_URL: "http://localhost:3002",
      REST_URL: "http://localhost:3003",
    });
    writeEnvDefaults(join(root, "opencollective-frontend/.env"), {
      API_URL: "http://localhost:3060",
      PDF_SERVICE_URL: "http://localhost:3002",
      IMAGES_URL: "http://localhost:3001",
      REST_URL: "http://localhost:3003",
    });
    for (const name of ["images", "rest", "pdf"])
      writeEnvDefaults(join(root, `opencollective-${name}/.env`), {
        API_URL: "http://localhost:3060",
        WEBSITE_URL: "http://localhost:3000",
        IMAGES_URL: "http://localhost:3001",
      });
    // API postinstall prepares the development database through its own scripts.
    // Keep that behavior instead of duplicating schema/migration logic here.
    execute(
      ["bash", join(assets, "shared/install-dependencies.sh"), ...required],
      { env: { ...stackEnv, PG_HOST: "127.0.0.1" } },
    );
    const exists = execute(
      [
        "psql",
        "-h",
        "127.0.0.1",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-tAc",
        "SELECT 1 FROM pg_database WHERE datname = 'opencollective_test'",
      ],
      { capture: true },
    );
    // Restore test fixtures only when the database is absent; rerunning setup
    // must not erase test data or development data already on the persistent disk.
    if (!exists.stdout.trim())
      execute(["npm", "run", "db:restore:test"], {
        cwd: api,
        env: { ...stackEnv, PG_HOST: "127.0.0.1" },
      });
    // RustFS can take longer than PostgreSQL. Bucket creation is repeatable.
    for (let attempt = 0; attempt < 30; attempt++) {
      if (
        execute(["npm", "run", "script", "scripts/dev/init-local-s3.ts"], {
          cwd: api,
          check: false,
        }).status === 0
      )
        break;
      if (attempt === 29)
        throw new Error(
          "Local S3 bucket initialization failed; inspect uploads logs and API .env",
        );
      await wait(2000);
    }
    output(
      "Dependencies and databases ready. In /workspace run: run frontend api",
    );
  }

  function doctor() {
    // Verify tool discovery and Docker access in the actual SSH user's session.
    // Successful version checks do not prove provider logins or app readiness.
    for (const tool of [
      "node",
      "npm",
      "git",
      "gh",
      "docker",
      "codex",
      "opencode",
      "psql",
    ])
      execute([tool, "--version"]);
    execute(["docker", "compose", "version"]);
    execute(["docker", "info", "--format", "{{.ServerVersion}}"]);
    execute(["findmnt", "-n", "-o", "SOURCE,FSTYPE,SIZE", "/"]);
    execute(["git", "status", "--short"]);
    output(
      "Guest toolchain ready. Model/GitHub logins and running applications are checked separately.",
    );
  }

  return { clone, initialize, gitStatus, stack, doctor };
}

if (isMain(import.meta.url))
  await main(() => {
    const [action, ...args] = process.argv.slice(2);
    if (
      !["clone", "initialize", "git-status", "stack", "doctor"].includes(
        action,
      ) ||
      args.length
    )
      throw new Error(
        "Usage: guest.mjs clone|initialize|git-status|stack|doctor",
      );
    if (action === "git-status") return console.log(createGuest().gitStatus());
    return createGuest()[action]();
  });
