#!/usr/bin/env node
// Guest Git configuration and development stack setup.
import { appendFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

export function createGuest({
  root = "/workspace",
  env = process.env,
  run = command,
  wait = sleep,
  output = console.log,
} = {}) {
  const execute = (args, options = {}) =>
    run(args, { cwd: root, env, ...options });

  function configureGit(protocol) {
    if (!["ssh", "https"].includes(protocol))
      throw new Error("git_protocol must be ssh or https");
    // Only guest-global configuration is written; shared remotes stay intact.
    for (const base of ["https://github.com/", "git@github.com:"]) {
      const result = execute(
        ["git", "config", "--global", "--unset-all", `url.${base}.insteadOf`],
        { check: false },
      );
      if (result.status !== 0 && result.status !== 5)
        throw new Error("Could not update guest Git URL configuration");
    }
    if (protocol === "https") {
      for (const prefix of ["git@github.com:", "ssh://git@github.com/"])
        execute([
          "git",
          "config",
          "--global",
          "--add",
          "url.https://github.com/.insteadOf",
          prefix,
        ]);
    } else {
      execute([
        "git",
        "config",
        "--global",
        "--add",
        "url.git@github.com:.insteadOf",
        "https://github.com/",
      ]);
    }
    // Resolve gh from PATH at credential-request time, including Orca sessions.
    const helper = "credential.https://github.com.helper";
    execute(["git", "config", "--global", "--replace-all", helper, ""]);
    execute([
      "git",
      "config",
      "--global",
      "--add",
      helper,
      "!gh auth git-credential",
    ]);
  }

  async function stack() {
    // Use the shared monorepo's npm and Compose workflows.
    const required = ["api", "frontend", "rest", "pdf", "images", "taxes"];
    for (const name of required) {
      if (!existsSync(join(root, `opencollective-${name}/package.json`)))
        throw new Error(
          `Missing /workspace/opencollective-${name}/package.json; prepare this service in the host checkout before setup`,
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
        join(root, "scripts/start-dependencies.sh"),
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
      ["bash", join(root, "scripts/install-dependencies.sh"), ...required],
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
    if (existsSync(join(root, ".git"))) {
      execute(["git", "status", "--short"]);
    } else if (existsSync(join(root, ".git-backup/git"))) {
      output(
        "Workspace Git is hidden. Restore it with scripts/restore-git.sh when needed.",
      );
    }
    output(
      "Guest toolchain ready. Model/GitHub logins and running applications are checked separately.",
    );
  }

  return { configureGit, stack, doctor };
}

if (isMain(import.meta.url))
  await main(() => {
    const [action, ...args] = process.argv.slice(2);
    const guest = createGuest();
    if (action === "configure-git" && args.length === 1)
      return guest.configureGit(args[0]);
    if (["stack", "doctor"].includes(action) && !args.length)
      return guest[action]();
    throw new Error("Usage: guest.mjs configure-git <ssh|https>|stack|doctor");
  });
