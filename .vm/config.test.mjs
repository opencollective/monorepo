// Settings tests use an isolated launcher directory and explicit environments so
// a developer's personal .vm/.vm.local.json and OC_VM_* overrides cannot affect CI.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { DEFAULTS, loadSettings } from "./config.mjs";

function fixture(t, config = {}) {
  // Exercise the real JSON-loading boundary, including malformed value types.
  const root = mkdtempSync(join(tmpdir(), "oc-config-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".vm"));
  writeFileSync(join(root, ".vm/.vm.local.json"), JSON.stringify(config));
  return root;
}

test("default Incus resources and current image are explicit", (t) => {
  assert.deepEqual(loadSettings(fixture(t), {}), DEFAULTS);
});

test("tracked example settings load and match the supported defaults", (t) => {
  const example = JSON.parse(
    readFileSync(new URL("./.vm.local.example.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(loadSettings(fixture(t, example), {}), DEFAULTS);
});

test("host-folder sharing defaults on and requires boolean configuration", (t) => {
  assert.equal(loadSettings(fixture(t), {}).share_host_folder, true);
  assert.equal(
    loadSettings(fixture(t, { share_host_folder: false }), {})
      .share_host_folder,
    false,
  );
  for (const value of ["true", "false", 1, 0, null]) {
    assert.throws(
      () => loadSettings(fixture(t, { share_host_folder: value }), {}),
      /share_host_folder must be a boolean/,
    );
  }
});

test("sharing environment overrides parse true/false without string truthiness", (t) => {
  const root = fixture(t, { share_host_folder: true });
  assert.equal(
    loadSettings(root, { OC_VM_SHARE_HOST_FOLDER: "false" }).share_host_folder,
    false,
  );
  assert.equal(
    loadSettings(fixture(t, { share_host_folder: false }), {
      OC_VM_SHARE_HOST_FOLDER: "true",
    }).share_host_folder,
    true,
  );
  for (const value of ["", "0", "1", "yes", "FALSE"]) {
    assert.throws(
      () => loadSettings(root, { OC_VM_SHARE_HOST_FOLDER: value }),
      /must be true or false/,
    );
  }
});

test("environment overrides local resources", (t) => {
  const root = fixture(t, {
    cpus: 4,
    memory_mb: 16384,
  });
  const settings = loadSettings(root, { OC_VM_CPUS: "12" });
  assert.equal(settings.cpus, 12);
  assert.equal(settings.memory_mb, 16384);
});

test("local settings live in .vm and a legacy root-level file is ignored", (t) => {
  const root = fixture(t, { cpus: 5 });
  writeFileSync(join(root, ".vm.local.json"), JSON.stringify({ cpus: 9 }));
  assert.equal(loadSettings(root, {}).cpus, 5);
});

// JavaScript coercion can turn booleans/null into resource numbers. These inputs
// must fail before any allocation rather than silently becoming valid settings.
for (const value of [
  0,
  -1,
  false,
  true,
  null,
  1.5,
  "1.5",
  "8;whoami",
  Number.MAX_SAFE_INTEGER + 1,
]) {
  test(`invalid resource ${JSON.stringify(value)} is rejected`, (t) => {
    assert.throws(
      () => loadSettings(fixture(t, { cpus: value }), {}),
      /positive integer/,
    );
  });
}

test("unknown settings and non-object configuration are rejected", (t) => {
  for (const config of [{ unknown: 1 }, { toString: "unsafe" }, [], null])
    assert.throws(() => loadSettings(fixture(t, config), {}));
});

test("networks must fit entirely inside a private IPv4 range", (t) => {
  for (const network_address of ["10.17.99.20/16", "172.16.121.44/24"])
    assert.equal(
      loadSettings(fixture(t, { network_address }), {}).network_address,
      network_address,
    );
  for (const network of [
    "8.8.8.0/24",
    "172.15.0.0/16",
    "192.168.1.0/15",
    "192.168.999.0/24",
    "10.0.0.0/29",
    "::1/24",
    "192.168.1.0",
  ])
    assert.throws(
      () => loadSettings(fixture(t, { network_address: network }), {}),
      /private IPv4/,
    );
});

test("unsafe clone URLs, refs and Incus names are rejected", (t) => {
  for (const config of [
    { repo_url: "https://token@github.com/org/repo" },
    { repo_url: "file:///tmp/repo" },
    { repo_url: "https://github.com/org/repo?token=secret" },
    { repo_url: "https://github.com/org/repo#ref" },
    { repo_ref: "-main" },
    { network_name: "name\nInjected" },
    { storage_pool: "../pool" },
    { project: "default" },
    { project: "other_project" },
    { instance_name: "../vm" },
    { network_name: "bridge-name-too-long" },
    { image: "ubuntu/24.04" },
    { box: "bento/ubuntu-24.04" },
    { box_version: "202508.03.0" },
    { provider: "libvirt" },
  ])
    assert.throws(() => loadSettings(fixture(t, config), {}));
});
