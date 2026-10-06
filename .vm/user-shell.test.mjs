import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Source the actual guest hook using temporary paths, without nvm or a VM.
function fixture(t, { workspaceExists = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "oc-shell-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const nested = join(workspace, "service");
  const aliases = join(root, "aliases.sh");
  const hook = join(root, "user-shell.sh");
  mkdirSync(home);
  if (workspaceExists) mkdirSync(nested, { recursive: true });
  writeFileSync(aliases, "# empty aliases fixture\n");
  writeFileSync(
    hook,
    readFileSync(new URL("./user-shell.sh", import.meta.url), "utf8")
      .replaceAll("/opt/oc-vm/shared/shell-aliases.sh", aliases)
      .replaceAll("/workspace", workspace),
  );
  return {
    home,
    workspace,
    nested,
    run: ({
      interactive = true,
      ssh = true,
      cwd = home,
      repeat = false,
    } = {}) => {
      const args = ["--noprofile", "--norc"];
      if (interactive) args.push("-i");
      args.push(
        "-c",
        `source "$1"; ${repeat ? 'source "$1";' : ""} printf '%s\\n' "$PWD"`,
        "oc-shell-test",
        hook,
      );
      return spawnSync("bash", args, {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          SSH_CONNECTION: ssh ? "192.168.121.1 49044 192.168.121.58 22" : "",
        },
      });
    },
  };
}

test("interactive guest SSH login starts in the workspace", (t) => {
  const f = fixture(t);
  const result = f.run({ repeat: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), f.workspace);
});

test("nested guest SSH shells keep their working directory", (t) => {
  const f = fixture(t);
  const result = f.run({ cwd: f.nested });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), f.nested);
});

test("noninteractive SSH commands keep their working directory", (t) => {
  const f = fixture(t);
  const result = f.run({ interactive: false });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), f.home);
});

test("local guest shells keep their working directory", (t) => {
  const f = fixture(t);
  const result = f.run({ ssh: false });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), f.home);
});

test("SSH login succeeds when the workspace does not exist yet", (t) => {
  const f = fixture(t, { workspaceExists: false });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), f.home);
});
