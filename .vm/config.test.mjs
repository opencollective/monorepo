import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULTS, loadSettings } from "./config.mjs";

test("settings use only environment overrides and defaults", () => {
  assert.deepEqual(loadSettings({}), DEFAULTS);
  assert.deepEqual(
    loadSettings({
      OC_VM_CPUS: "4",
      OC_VM_MEMORY_MB: "16384",
      OC_VM_DISK_GB: "20",
      OC_VM_INSTANCE_NAME: "other",
      OC_VM_IMAGE: "ubuntu:24.04",
    }),
    {
      cpus: 4,
      memory_mb: 16384,
      disk_gb: 20,
      instance_name: "other",
      image: "ubuntu:24.04",
    },
  );
});

test("invalid resources, names and non-OCI images fail before allocation", () => {
  for (const value of [
    "0",
    "-1",
    "1.5",
    "true",
    "",
    "8;whoami",
    "9007199254740992",
    "256",
  ])
    assert.throws(() => loadSettings({ OC_VM_CPUS: value }));
  for (const value of ["../name", "name\nHost *", "-flag", "a".repeat(64)])
    assert.throws(() => loadSettings({ OC_VM_INSTANCE_NAME: value }));
  for (const value of ["", "/tmp/disk", "./root", "--flag", "ubuntu\n:24.04"])
    assert.throws(() => loadSettings({ OC_VM_IMAGE: value }));
});
