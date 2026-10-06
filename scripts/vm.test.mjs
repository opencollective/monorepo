// Test the shared shell entry points from outside a checkout as SSH/editor users
// may invoke them that way. Fixtures supply harmless commands, not live services.
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "oc-vm-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, "bin"));
  mkdirSync(path.join(directory, "opencollective-api", "docker-compose"), {
    recursive: true,
  });
  for (const service of ["db", "mail", "uploads"]) {
    writeFileSync(
      path.join(
        directory,
        "opencollective-api",
        "docker-compose",
        `${service}.yml`,
      ),
      "services: {}\n",
    );
  }
  return directory;
}

test("dependency launcher uses existing Compose files and runs outside the repository", (t) => {
  const directory = fixture(t);
  const trace = path.join(directory, "trace.json");
  // Record the launch without running Docker. Compose receives the original
  // files and the VM project name, preserving its named-volume identity.
  writeFileSync(
    path.join(directory, "bin", "docker"),
    `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.TRACE, JSON.stringify({
  args: process.argv.slice(2), cwd: process.cwd(), project: process.env.COMPOSE_PROJECT_NAME
}));
`,
    { mode: 0o755 },
  );
  const result = spawnSync(
    "bash",
    [
      path.join(root, "scripts/start-dependencies.sh"),
      "--engine",
      "docker",
      "--detach",
      "db",
      "mail",
      "uploads",
    ],
    {
      cwd: os.tmpdir(),
      env: {
        ...process.env,
        OC_MONOREPO_ROOT: directory,
        COMPOSE_PROJECT_NAME: "oc-development",
        PATH: `${directory}/bin:${process.env.PATH}`,
        TRACE: trace,
      },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const invocation = JSON.parse(readFileSync(trace, "utf8"));
  assert.equal(invocation.cwd, directory);
  assert.equal(invocation.project, "oc-development");
  assert.deepEqual(invocation.args, [
    "compose",
    ...["db", "mail", "uploads"].flatMap((service) => [
      "-f",
      path.join(
        directory,
        "opencollective-api/docker-compose",
        service + ".yml",
      ),
    ]),
    "up",
    "-d",
  ]);
});

test("dependency launcher rejects path traversal and unsupported engines", (t) => {
  const directory = fixture(t);
  writeFileSync(path.join(directory, "bin", "docker"), "#!/bin/sh\nexit 99\n", {
    mode: 0o755,
  });
  for (const args of [
    ["--engine", "docker", "../secret"],
    ["--engine", "invalid", "db"],
  ]) {
    const result = spawnSync(
      "bash",
      [path.join(root, "scripts/start-dependencies.sh"), ...args],
      {
        env: {
          ...process.env,
          OC_MONOREPO_ROOT: directory,
          PATH: `${directory}/bin:${process.env.PATH}`,
        },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 1);
  }
});

test("shell shortcuts find a workspace with hidden Git from a service and nested worktree", (t) => {
  const directory = fixture(t);
  mkdirSync(path.join(directory, "scripts"));
  writeFileSync(path.join(directory, "scripts/init.sh"), "");
  mkdirSync(path.join(directory, ".git-backup/git"), { recursive: true });
  writeFileSync(path.join(directory, "scripts/run.sh"), "#!/bin/sh\npwd\n", {
    mode: 0o755,
  });
  for (const relative of [
    "opencollective-api",
    ".worktrees/feature/opencollective-frontend",
  ]) {
    const cwd = path.join(directory, relative);
    mkdirSync(cwd, { recursive: true });
    const env = { ...process.env };
    delete env.OC_MONOREPO_ROOT;
    const result = spawnSync(
      "bash",
      [
        "-c",
        'source "$1"; run',
        "test-shell",
        path.join(root, ".devcontainer/shell-aliases.sh"),
      ],
      { cwd, env, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), directory);
  }
});

test("run script resolves its root before starting PM2 from a service directory", (t) => {
  const directory = fixture(t);
  mkdirSync(path.join(directory, "scripts"));
  copyFileSync(
    path.join(root, "scripts/run.sh"),
    path.join(directory, "scripts/run.sh"),
  );
  writeFileSync(path.join(directory, "bin/npx"), "#!/bin/sh\npwd\n", {
    mode: 0o755,
  });
  const result = spawnSync(
    "bash",
    [path.join(directory, "scripts/run.sh"), "--background", "api"],
    {
      cwd: path.join(directory, "opencollective-api"),
      env: { ...process.env, PATH: `${directory}/bin:${process.env.PATH}` },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(directory));
});
