#!/usr/bin/env node
import { spawnSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

export const projects = [
  "api",
  "frontend",
  "pdf",
  "rest",
  "images",
  "taxes",
  "rss",
  "documentation",
];
export const root = resolve(
  process.env.OC_MONOREPO_ROOT ||
    join(dirname(fileURLToPath(import.meta.url)), ".."),
);
const readJSON = (path) => JSON.parse(readFileSync(path, "utf8"));
export function packages() {
  return projects.flatMap((short) => {
    const directory = join(root, `opencollective-${short}`);
    return existsSync(join(directory, "package.json"))
      ? [{ short, directory, ...readJSON(join(directory, "package.json")) }]
      : [];
  });
}

// Services are independent repository roots, so their public npm commands enter
// Turbo too. Select the underlying task when scheduling them from the workspace.
export function serviceTask(pkg, task) {
  if (pkg.scripts[`${task}:task`]) return `${task}:task`;
  const entrypoint = pkg.scripts[task]?.match(
    /^npm run turbo -- run (\S+)(?: --)?$/,
  );
  return entrypoint ? entrypoint[1] : task;
}

// npm still resolves every workspace during a root install. Keep the toolchain
// independently locked and use a generated lock only for Turbo's package graph.
export function prepare() {
  const tooling = join(root, "scripts/tooling");
  const binary = join(tooling, "node_modules/.bin/turbo");
  if (!existsSync(binary))
    throw new Error("Install Turbo first: npm run install:tooling");
  if (!existsSync(join(root, "node_modules")))
    symlinkSync(
      join(tooling, "node_modules"),
      join(root, "node_modules"),
      "dir",
    );
  const lock = readJSON(join(tooling, "package-lock.json"));
  lock.name = "opencollective-workspace";
  lock.packages[""] = {
    name: lock.name,
    workspaces: readJSON(join(root, "package.json")).workspaces,
  };
  for (const pkg of packages()) {
    const path = `opencollective-${pkg.short}`;
    lock.packages[path] = Object.fromEntries(
      ["name", "version", "dependencies", "devDependencies"]
        .filter((key) => pkg[key] !== undefined)
        .map((key) => [key, pkg[key]]),
    );
    lock.packages[`node_modules/${pkg.name}`] = { resolved: path, link: true };
  }
  const serialized = `${JSON.stringify(lock, null, 2)}\n`;
  const target = join(root, "package-lock.json");
  if (!existsSync(target) || readFileSync(target, "utf8") !== serialized) {
    mkdirSync(join(root, ".turbo"), { recursive: true });
    const temporary = join(root, ".turbo", `package-lock-${process.pid}.json`);
    writeFileSync(temporary, serialized);
    renameSync(temporary, target);
  }
  return binary;
}

export function runTurbo(args, env = process.env) {
  const locks = Object.fromEntries(
    packages().map((pkg) => [
      `OC_LOCKFILE_HASH_${pkg.short.toUpperCase()}`,
      existsSync(join(pkg.directory, "package-lock.json"))
        ? createHash("sha256")
            .update(readFileSync(join(pkg.directory, "package-lock.json")))
            .digest("hex")
        : "missing",
    ]),
  );
  const child = spawn(prepare(), args, {
    cwd: root,
    env: {
      ...env,
      ...locks,
      TURBO_TELEMETRY_DISABLED: "1",
      TURBO_AGENT_GUIDANCE: "false",
    },
    stdio: "inherit",
  });
  const handlers = ["SIGINT", "SIGTERM"].map((signal) => {
    const handler = () => child.kill(signal);
    process.on(signal, handler);
    return [signal, handler];
  });
  return new Promise((resolveStatus, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      for (const [event, handler] of handlers) process.off(event, handler);
      resolveStatus(code ?? (signal === "SIGINT" ? 130 : 143));
    });
  });
}

export function taskArguments(argv) {
  let [task, ...args] = argv;
  if (!task || task === "--help" || task === "-h") return { help: true };
  if (task === "run") {
    const available = packages();
    const separator = args.findIndex((arg) => arg.startsWith("-"));
    const targets = separator < 0 ? args : args.slice(0, separator);
    const options = separator < 0 ? [] : args.slice(separator);
    return {
      turbo: [
        "run",
        ...new Set(
          targets.flatMap((target) => {
            const [name, command] = target.split("#");
            if (command) {
              const pkg = available.find((pkg) => pkg.name === name);
              return pkg ? `${name}#${serviceTask(pkg, command)}` : target;
            }
            const providers = available.filter((pkg) => pkg.scripts[target]);
            return providers.length
              ? providers.map((pkg) => serviceTask(pkg, target))
              : target;
          }),
        ),
        ...options,
      ],
    };
  }
  if (task === "setup") return { setup: true };
  if (args.some((arg) => ["-b", "--background"].includes(arg)))
    throw new Error(
      "Detached mode was removed. Run a foreground Turbo session; Ctrl-C stops its services.",
    );
  const separator = args.indexOf("--");
  const forwarded = separator < 0 ? [] : args.slice(separator);
  const options = separator < 0 ? args : args.slice(0, separator);
  const selectors = options.filter((arg) => !arg.startsWith("-"));
  const flags = options.filter((arg) => arg.startsWith("-"));
  if (flags.includes("--help") || flags.includes("-h")) return { help: true };
  const available = packages();
  const chosen = selectors.length
    ? selectors
    : task === "dev"
      ? available
          .filter((pkg) => ["frontend", "api"].includes(pkg.short))
          .map((pkg) => pkg.short)
      : available
          .filter(
            (pkg) =>
              pkg.scripts[task] ||
              (task === "build" && pkg.scripts["build:finalize"]),
          )
          .map((pkg) => pkg.short);
  const env = { ...process.env };
  const tasks = chosen.map((selector) => {
    const [name, environment, ...extra] = selector.split(":");
    const short = name.replace(/^opencollective-/, "");
    const pkg = available.find((pkg) => pkg.short === short);
    if (!pkg)
      throw new Error(
        `Unknown or uninitialized project '${name}'. Available: ${available.map((pkg) => pkg.short).join(", ")}`,
      );
    if (
      extra.length ||
      (environment !== undefined &&
        (!/^[a-zA-Z0-9_-]+$/.test(environment) || task !== "dev"))
    )
      throw new Error(
        `Invalid selection '${selector}'; environment suffixes are supported for dev only.`,
      );
    let leaf =
      task === "build" && pkg.scripts["build:finalize"]
        ? "build:finalize"
        : task === "build" && pkg.scripts["build:compile"]
          ? "build:compile"
          : task === "graphql:update" && pkg.scripts["graphql:refresh"]
            ? "graphql:refresh"
            : task;
    if (
      task === "graphql:update" &&
      ["rest", "images"].includes(short) &&
      existsSync(
        join(root, "opencollective-frontend/lib/graphql/schema.graphql"),
      )
    )
      leaf = chosen.some((item) =>
        ["frontend", "opencollective-frontend"].includes(item),
      )
        ? "graphql:sync:after-frontend"
        : "graphql:sync:local";
    if (environment) {
      env[`OC_DEV_ENV_${short.toUpperCase()}`] = environment;
      leaf = "dev:environment";
    }
    leaf = serviceTask(pkg, leaf);
    if (!pkg.scripts[leaf])
      throw new Error(
        `${pkg.name} has no '${leaf}' command. Adopt its Turbo configuration first.`,
      );
    return `${pkg.name}#${leaf}`;
  });
  if (!tasks.length)
    throw new Error(`No initialized packages provide '${task}'.`);
  // Exact package task IDs avoid starting runtime dependencies or forwarding one
  // service's environment to another. Let the graph schedule prerequisites.
  return {
    turbo: [
      "run",
      ...new Set(tasks),
      ...(task === "dev" || task === "test:watch"
        ? [
            `--ui=${process.stdout.isTTY && !process.env.CI ? "tui" : "stream"}`,
            `--concurrency=${Math.max(10, tasks.length + 1)}`,
          ]
        : []),
      ...flags,
      ...forwarded,
    ],
    env,
  };
}

async function main() {
  const parsed = taskArguments(process.argv.slice(2));
  if (parsed.help) {
    console.log(
      "Usage: node scripts/turbo.mjs <task> [project[:environment]...] [--filter=...] [--dry=json] [-- runner-arguments]\nDefault dev services: frontend api. Use run <tasks> for the native Turbo CLI.\nInstall toolchain: npm run install:tooling. Install services: npm run install:services.",
    );
    return;
  }
  if (parsed.setup) {
    const result = spawnSync(
      "npm",
      [
        "ci",
        "--prefix",
        join(root, "scripts/tooling"),
        "--no-audit",
        "--no-fund",
      ],
      { cwd: root, stdio: "inherit" },
    );
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      return;
    }
    prepare();
    return;
  }
  process.exitCode = await runTurbo(parsed.turbo, parsed.env);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
