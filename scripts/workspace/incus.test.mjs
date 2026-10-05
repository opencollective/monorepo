import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const scripts = dirname(fileURLToPath(import.meta.url));
const owner = "11111111-1111-1111-1111-111111111111";
const current = "a".repeat(64),
  previous = "b".repeat(64),
  candidate = "c".repeat(64);
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "incus-contract-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "bin"));
  writeFileSync(
    join(dir, "aliases"),
    JSON.stringify([
      { name: "oc-development", target: current },
      { name: "oc-development-previous", target: previous },
      { name: "candidate", target: candidate },
    ]),
  );
  writeFileSync(
    join(dir, "bin/incus"),
    `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$*" >> "$TEST_DIR/events"
[[ "$1" == --force-local && "$2" == --project && "$3" == orca ]] || exit 99
shift 3
case "$1 $2" in
  'config show') printf '{}\\n' ;;
  'config get') if [[ "$4" == user.oc-workspace-role ]]; then echo workspace; else echo "\${TEST_RESOURCE_OWNER:-$TEST_OWNER}"; fi ;;
  'list --format'|'list ^oc-orca-test-one$')
    [[ "\${TEST_INVENTORY_FAIL:-}" != 1 ]] || exit 1
    if [[ "\${TEST_ABSENT:-}" == 1 ]]; then echo '[]'; else printf '[{"name":"oc-orca-test-one","status":"Running"}]\\n'; fi ;;
  'stop oc-orca-test-one') [[ "\${TEST_SUSPEND_FAIL:-}" != 1 ]] ;;
  'delete oc-orca-test-one'|'init candidate') ;;
  'image alias') [[ "$3" == list ]] && cat "$TEST_DIR/aliases" ;;
  'query /1.0/instances/oc-orca-test-one/state?project=orca') echo '{"network":{"eth0":{"addresses":[{"family":"inet","scope":"global","address":"10.231.0.7"}]}}}' ;;
  query*)
    if [[ "$2" == -X ]]; then
      path=$6; name=\${path##*/}; name=\${name%%[?]*}
      [[ "\${TEST_PROMOTION_FAIL:-}" != 1 || "$name" != oc-development ]] || exit 1
      jq --arg name "$name" --argjson data "$5" 'map(if .name==$name then .target=$data.target else . end)' "$TEST_DIR/aliases" > "$TEST_DIR/next"
      mv "$TEST_DIR/next" "$TEST_DIR/aliases"
    else
      path=$2; fingerprint=\${path##*/}; fingerprint=\${fingerprint%%[?]*}
      jq -cn --arg fp "$fingerprint" --arg owner "\${TEST_RESOURCE_OWNER:-$TEST_OWNER}" '{fingerprint:$fp,public:false,properties:{"user.oc-workspace-owner":$owner}}'
    fi ;;
  *) exit 98 ;;
esac
`,
    { mode: 0o755 },
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(WORKSPACE_|INCUS_|ORCA_)/.test(key),
    ),
  );
  Object.assign(env, {
    TEST_DIR: dir,
    TEST_OWNER: owner,
    PATH: `${dir}/bin:${env.PATH}`,
  });
  const run = (body, extra = {}) =>
    spawnSync(
      "bash",
      [
        "-c",
        'set -Eeuo pipefail; source "$1/config.sh"; workspace_load_config /nonexistent; source "$1/backends/incus.sh"; OWNER=$TEST_OWNER; handle=$(backend_handle orca-test-one workspace); ' +
          body,
        "bash",
        scripts,
      ],
      { env: { ...env, ...extra }, encoding: "utf8" },
    );
  return {
    dir,
    run,
    events: () => readFileSync(join(dir, "events"), "utf8"),
    aliases: () => JSON.parse(readFileSync(join(dir, "aliases"), "utf8")),
  };
}
test("Incus suspend uses stateful stop and returns failure without a shutdown fallback", (t) => {
  const f = fixture(t);
  const failed = f.run('backend_suspend "$handle"', { TEST_SUSPEND_FAIL: "1" });
  assert.notEqual(failed.status, 0);
  assert.equal(
    f
      .events()
      .split("\n")
      .filter((line) => line.includes(" stop ")).length,
    1,
  );
  assert.match(f.events(), /stop oc-orca-test-one --stateful/);
  assert.doesNotMatch(f.events(), /--stateless|--force(?:\s|$)/);
});
test("Incus deletion distinguishes absent resources from inventory errors and foreign ownership", (t) => {
  for (const extra of [
    { TEST_INVENTORY_FAIL: "1" },
    { TEST_RESOURCE_OWNER: "foreign" },
  ]) {
    const f = fixture(t);
    assert.notEqual(f.run('backend_destroy "$handle"', extra).status, 0);
    assert.doesNotMatch(f.events(), / delete /);
  }
  const absent = fixture(t);
  assert.equal(
    absent.run('backend_destroy "$handle"', { TEST_ABSENT: "1" }).status,
    0,
  );
  assert.doesNotMatch(absent.events(), / delete /);
  const owned = fixture(t);
  assert.equal(owned.run('backend_destroy "$handle"').status, 0);
  assert.match(owned.events(), /delete oc-orca-test-one --force/);
});
test("Incus obtains guest addresses through explicitly scoped state API", (t) => {
  const f = fixture(t);
  const r = f.run('backend_address "$handle"');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "10.231.0.7");
  assert.match(f.events(), /state\?project=orca/);
});
test("Incus creates VMs using only the resource profile and ownership tags", (t) => {
  const f = fixture(t);
  const r = f.run('backend_create "$handle" candidate', { TEST_ABSENT: "1" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    f.events(),
    /init candidate oc-orca-test-one --vm --profile oc-workspace -c user.oc-workspace-owner=/,
  );
  assert.doesNotMatch(f.events(), /source=|unix.socket|device add|--mount/);
});
test("Incus promotion is scoped and retains old active image as previous", (t) => {
  const f = fixture(t);
  const r = f.run("backend_promote candidate");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    f.aliases().find((a) => a.name === "oc-development").target,
    candidate,
  );
  assert.equal(
    f.aliases().find((a) => a.name === "oc-development-previous").target,
    current,
  );
  assert.match(f.events(), /aliases\/oc-development\?project=orca/);
});
test("Incus failed promotion restores previous and preserves active", (t) => {
  const f = fixture(t);
  const r = f.run("backend_promote candidate", { TEST_PROMOTION_FAIL: "1" });
  assert.notEqual(r.status, 0);
  assert.equal(
    f.aliases().find((a) => a.name === "oc-development").target,
    current,
  );
  assert.equal(
    f.aliases().find((a) => a.name === "oc-development-previous").target,
    previous,
  );
});
test("Incus images and opaque handles must belong to this installation", (t) => {
  const f = fixture(t);
  assert.notEqual(
    f.run("backend_promote candidate", { TEST_RESOURCE_OWNER: "foreign" })
      .status,
    0,
  );
  assert.notEqual(
    f.run(
      'backend_destroy \'{"name":"oc-orca-test-one","project":"foreign","owner":"foreign","role":"workspace"}\'',
    ).status,
    0,
  );
  assert.doesNotMatch(f.events(), / delete |query -X/);
});
test("candidate cleanup refuses active and rollback images", (t) => {
  const f = fixture(t);
  assert.notEqual(f.run("backend_image_discard oc-development").status, 0);
  assert.notEqual(
    f.run("backend_image_discard oc-development-previous").status,
    0,
  );
  assert.doesNotMatch(f.events(), /image delete/);
});

test("network overlap detection rejects LAN, VPN routes and inventory failures", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "network-contract-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, "ip"),
    '#!/bin/bash\n[[ "${TEST_ROUTE_FAIL:-}" != 1 ]] || exit 1\nprintf "%s\\n" "$TEST_ROUTES"\n',
    { mode: 0o755 },
  );
  const run = (routes, extra = {}) =>
    spawnSync(
      "bash",
      [join(scripts, "network-check.sh"), "10.231.0.1/24", "orcabr0"],
      {
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          TEST_ROUTES: JSON.stringify(routes),
          ...extra,
        },
        encoding: "utf8",
      },
    );
  for (const dst of ["10.231.0.0/24", "10.0.0.0/8", "10.231.0.128/25"]) {
    assert.notEqual(run([{ dst, dev: "vpn0" }]).status, 0, dst);
  }
  assert.equal(
    run([
      { dst: "default", dev: "eth0" },
      { dst: "10.231.0.0/24", dev: "orcabr0" },
      { dst: "192.168.1.0/24", dev: "eth0" },
    ]).status,
    0,
  );
  assert.notEqual(run([], { TEST_ROUTE_FAIL: "1" }).status, 0);
});
