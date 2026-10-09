#!/usr/bin/env node
// Three-way merge one replayed commit's manifest onto the current rebased HEAD.
// usage: reapply-bump.js <parent> <commit> [onto=HEAD]
// Fails without writing on overlapping changes. Lockfiles must be regenerated in full.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const [base, commit, onto = "HEAD"] = process.argv.slice(2);
if (!base || !commit || onto === "--lock") {
  console.error("usage: reapply-bump.js <parent> <commit> [onto=HEAD]");
  process.exit(2);
}
const show = (ref) =>
  JSON.parse(
    execFileSync("git", ["show", `${ref}:package.json`], { encoding: "utf8" }),
  );
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const same = (a, b) => {
  if (object(a) && object(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((key) => same(a[key], b[key]));
  }
  return JSON.stringify(a) === JSON.stringify(b);
};
function merge(before, after, current, path = "package.json") {
  if (same(before, after) || same(after, current)) return current;
  if (same(before, current)) return after;
  if (object(before) && object(after) && object(current)) {
    const result = { ...current };
    for (const key of new Set([
      ...Object.keys(before),
      ...Object.keys(after),
    ])) {
      const value = merge(
        before[key],
        after[key],
        current[key],
        `${path}.${key}`,
      );
      if (value === undefined) delete result[key];
      else result[key] = value;
    }
    return result;
  }
  throw new Error(`Overlapping changes at ${path}; resolve manually`);
}
// npm keeps dependency sections sorted; a replayed key would otherwise land at the end of its section
const SORTED = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const sortSections = (pkg) => {
  for (const s of SORTED) {
    if (!object(pkg[s])) continue;
    pkg[s] = Object.fromEntries(
      Object.keys(pkg[s])
        .sort()
        .map((k) => [k, pkg[s][k]]),
    );
  }
  return pkg;
};
try {
  const result = sortSections(merge(show(base), show(commit), show(onto)));
  fs.writeFileSync("package.json", JSON.stringify(result, null, 2) + "\n");
  console.log("package.json: replayed this commit on the rebased HEAD");
} catch (error) {
  console.error(error.message);
  process.exit(3);
}
