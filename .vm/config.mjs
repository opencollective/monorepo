// VM settings for the host launcher.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isMain, main } from "./process.mjs";

export const DEFAULTS = Object.freeze({
  cpus: 8,
  memory_mb: 43008, // 42 GiB, expressed in MiB.
  disk_gb: 100,
  image: "images:ubuntu/24.04/cloud",
  project: "oc-development",
  instance_name: "oc-dev",
  storage_pool: "oc-development",
  network_name: "oc-development",
  network_address: "192.168.121.0/24",
  git_protocol: "https",
});
function localSettings(root) {
  const path = join(root, ".vm/.vm.local.json");
  const local = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  if (!local || Array.isArray(local) || typeof local !== "object")
    throw new Error(".vm/.vm.local.json must contain a JSON object");
  // Fail on misspellings rather than silently booting with unintended defaults.
  const unknown = Object.keys(local).filter(
    (key) => !Object.hasOwn(DEFAULTS, key),
  );
  if (unknown.length)
    throw new Error(`Unknown VM settings: ${unknown.join(", ")}`);
  return local;
}

// Keep the Incus management network entirely within a private IPv4 range.
function validateNetwork(address) {
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(address);
  const octets = match?.slice(1, 5).map(Number);
  const prefix = Number(match?.[5]);
  if (
    !match ||
    octets.some((octet) => octet > 255) ||
    prefix < 16 ||
    prefix > 28
  )
    throw new Error(
      "network_address must be a private IPv4 network with prefix /16 through /28",
    );
  // Arithmetic avoids JavaScript's signed 32-bit bitwise representation of IPv4.
  // Normalize host bits, then check the entire subnet, not just its first address.
  const number = octets.reduce((value, octet) => value * 256 + octet, 0);
  const base = Math.floor(number / 2 ** (32 - prefix)) * 2 ** (32 - prefix);
  const end = base + 2 ** (32 - prefix) - 1;
  const privateRanges = [
    [0x0a000000, 0x0affffff],
    [0xac100000, 0xac1fffff],
    [0xc0a80000, 0xc0a8ffff],
  ];
  if (!privateRanges.some(([start, finish]) => base >= start && end <= finish))
    throw new Error(
      "network_address must be a private IPv4 network with prefix /16 through /28",
    );
}

export function loadSettings(root, env = process.env) {
  const local = localSettings(root);
  // Precedence: environment > personal JSON > tracked defaults.
  const settings = Object.fromEntries(
    Object.entries(DEFAULTS).map(([key, value]) => [
      key,
      env[`OC_VM_${key.toUpperCase()}`] ??
        (Object.hasOwn(local, key) ? local[key] : value),
    ]),
  );
  // Environment variables arrive as strings; reject coercions such as true -> 1.
  for (const key of ["cpus", "memory_mb", "disk_gb"]) {
    const value = settings[key];
    if (
      !(
        (typeof value === "number" && Number.isSafeInteger(value)) ||
        (typeof value === "string" && /^\d+$/.test(value))
      ) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) <= 0
    )
      throw new Error(`${key} must be a positive integer`);
    settings[key] = Number(value);
  }
  for (const key of Object.keys(DEFAULTS).filter(
    (key) => !["cpus", "memory_mb", "disk_gb"].includes(key),
  )) {
    if (
      typeof settings[key] !== "string" ||
      !settings[key] ||
      /[\x00-\x20\x7f]/.test(settings[key])
    )
      throw new Error(`${key} must be a nonempty string without whitespace`);
  }
  for (const key of [
    "storage_pool",
    "network_name",
    "project",
    "instance_name",
  ]) {
    if (
      !/^[a-zA-Z][a-zA-Z0-9-]*$/.test(settings[key]) ||
      settings[key].length > 63
    )
      throw new Error(`Invalid ${key}`);
  }
  if (settings.network_name.length > 15)
    throw new Error(
      "network_name must fit a Linux bridge name (15 characters)",
    );
  if (settings.project === "default")
    throw new Error(
      "Use a dedicated project rather than the Incus default project",
    );
  if (
    !/^[a-zA-Z][a-zA-Z0-9-]*:[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(settings.image)
  )
    throw new Error(
      "image must be an Incus remote:alias or remote:fingerprint",
    );
  validateNetwork(settings.network_address);
  if (!["ssh", "https"].includes(settings.git_protocol))
    throw new Error("git_protocol must be ssh or https");
  return settings;
}

// Keep diagnostics on stderr; consumers can read validated settings as JSON.
if (isMain(import.meta.url))
  await main(() =>
    console.log(JSON.stringify(loadSettings(process.argv[2] ?? process.cwd()))),
  );
