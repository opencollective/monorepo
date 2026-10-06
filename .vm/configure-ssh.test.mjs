import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const helper = fileURLToPath(new URL("./configure-ssh.sh", import.meta.url));

// Run the real shell helper against temporary configs and fake sshd/systemctl.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oc-ssh-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const config = join(root, "sshd_config");
  const policy = join(root, "oc-development.conf");
  const trace = join(root, "trace");
  const original = "PasswordAuthentication no\n";
  writeFileSync(config, original, { mode: 0o644 });
  writeFileSync(trace, "");
  const fake = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs');
const { basename } = require('node:path');
const tool = basename(process.argv[1]);
const args = process.argv.slice(2);
appendFileSync(process.env.TRACE, JSON.stringify({ tool, args }) + '\\n');
if ((tool === 'sshd' && args.includes('-t') && process.env.FAIL === 'validation') ||
    (tool === 'systemctl' && process.env.FAIL === 'reload')) process.exit(1);
if (tool === 'sshd' && args.includes('-T')) {
  const config = readFileSync(args[args.indexOf('-f') + 1], 'utf8');
  const policy = config.split('\\n')[0].slice('Include '.length);
  let lines = readFileSync(policy, 'utf8').toLowerCase().split('\\n').filter(line => line && !line.startsWith('#'));
  if (process.env.FAIL === 'override') lines = lines.filter(line => !line.startsWith('usepam ')).concat('usepam no');
  if (process.env.SFTP) lines.push('subsystem sftp /usr/lib/openssh/sftp-server');
  console.log(lines.join('\\n'));
}
`;
  for (const tool of ["sshd", "systemctl"])
    writeFileSync(join(bin, tool), fake, { mode: 0o755 });
  return {
    root,
    config,
    policy,
    original,
    backup: `${config}.oc-vm-before`,
    calls: () =>
      readFileSync(trace, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse),
    run: (env = {}) =>
      spawnSync(
        "bash",
        [
          "-c",
          'source "$1"; configure_ssh "$2" "$3" "$4" "$5"',
          "oc-ssh-test",
          helper,
          config,
          policy,
          join(bin, "sshd"),
          join(bin, "systemctl"),
        ],
        {
          encoding: "utf8",
          env: { ...process.env, TRACE: trace, FAIL: "", SFTP: "", ...env },
        },
      ),
  };
}

test("minimal guest SSH config enables PAM and SFTP and is safe to repeat", (t) => {
  const f = fixture(t);
  let result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const first = readFileSync(f.config, "utf8");
  assert.equal(first, `Include ${f.policy}\n${f.original}`);
  for (const setting of [
    "UsePAM yes",
    "PubkeyAuthentication yes",
    "PasswordAuthentication no",
    "KbdInteractiveAuthentication no",
    "PermitRootLogin no",
    "Subsystem sftp internal-sftp",
  ])
    assert.ok(readFileSync(f.policy, "utf8").includes(setting));
  assert.equal(readFileSync(f.backup, "utf8"), f.original);
  assert.equal(statSync(f.backup).mode & 0o777, 0o600);
  result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(f.config, "utf8"), first);
  assert.equal(readFileSync(f.backup, "utf8"), f.original);
  assert.equal(statSync(f.config).mode & 0o777, 0o644);
  assert.ok(
    f
      .calls()
      .filter(({ args }) => args.includes("-T"))
      .every(({ args }) =>
        args.includes("user=ubuntu,host=localhost,addr=127.0.0.1"),
      ),
  );
  assert.ok(f.calls().at(-2).args.includes("-t"));
  assert.deepEqual(f.calls().at(-1), {
    tool: "systemctl",
    args: ["reload-or-restart", "ssh"],
  });
});

test("existing guest SFTP and SSH configuration are preserved", (t) => {
  const f = fixture(t);
  const original =
    "Include /etc/ssh/sshd_config.d/*.conf\nUsePAM no\nSubsystem sftp /usr/lib/openssh/sftp-server\nMatch User other\n  X11Forwarding no\n";
  writeFileSync(f.config, original);
  const result = f.run({ SFTP: "1" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(f.config, "utf8"),
    `Include ${f.policy}\n${original}`,
  );
  assert.equal(readFileSync(f.policy, "utf8").includes("Subsystem"), false);
});

test("guest SSH validation failure restores both files without reloading", (t) => {
  const f = fixture(t);
  writeFileSync(f.policy, "# previous policy\n", { mode: 0o600 });
  const result = f.run({ FAIL: "validation" });
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(f.config, "utf8"), f.original);
  assert.equal(readFileSync(f.policy, "utf8"), "# previous policy\n");
  assert.equal(statSync(f.policy).mode & 0o777, 0o600);
  assert.equal(
    f.calls().some(({ tool }) => tool === "systemctl"),
    false,
  );
});

test("guest SSH effective policy overrides restore config and remove new policy", (t) => {
  const f = fixture(t);
  const result = f.run({ FAIL: "override" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /overrides the required login policy/);
  assert.equal(readFileSync(f.config, "utf8"), f.original);
  assert.equal(existsSync(f.policy), false);
  assert.equal(
    f.calls().some(({ tool }) => tool === "systemctl"),
    false,
  );
});

test("guest SSH reload failure leaves valid config and can be retried", (t) => {
  const f = fixture(t);
  assert.notEqual(f.run({ FAIL: "reload" }).status, 0);
  const first = readFileSync(f.config, "utf8");
  assert.ok(first.startsWith(`Include ${f.policy}\n`));
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(f.config, "utf8"), first);
});
