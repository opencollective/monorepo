#!/usr/bin/env node
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { packages, root } from "./turbo.mjs";

const action = process.argv[2];
if (!["link", "unlink"].includes(action))
  throw new Error("Usage: local-taxes.mjs link|unlink");
const taxes = join(root, "opencollective-taxes");
const consumers = packages().filter((pkg) =>
  ["api", "frontend", "pdf"].includes(pkg.short),
);
if (action === "link" && !existsSync(join(taxes, "dist/index.js")))
  throw new Error("Build taxes before linking: npm run taxes:link");
const selections = consumers.map((pkg) => ({
  pkg,
  target: join(pkg.directory, "node_modules/@opencollective/taxes"),
  backup: join(pkg.directory, ".turbo/published-taxes"),
}));
// Validate every consumer before changing any installed package.
for (const { pkg, target, backup } of selections) {
  if (action === "link" && !existsSync(join(pkg.directory, "node_modules")))
    throw new Error(`Install ${pkg.name} before linking taxes.`);
  if (
    existsSync(target) &&
    lstatSync(target).isSymbolicLink() &&
    realpathSync(target) !== realpathSync(taxes)
  )
    throw new Error(`Refusing to replace another taxes link in ${pkg.name}.`);
  if (
    action === "link" &&
    existsSync(backup) &&
    existsSync(target) &&
    !lstatSync(target).isSymbolicLink()
  )
    throw new Error(
      `Published taxes backup already exists in ${pkg.name}; unlink first.`,
    );
}
for (const { pkg, target, backup } of selections) {
  if (action === "link") {
    if (existsSync(target) && lstatSync(target).isSymbolicLink()) continue;
    mkdirSync(join(pkg.directory, ".turbo"), { recursive: true });
    mkdirSync(join(pkg.directory, "node_modules/@opencollective"), {
      recursive: true,
    });
    if (existsSync(target)) renameSync(target, backup);
    symlinkSync(taxes, target, "dir");
  } else if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
    rmSync(target);
    if (existsSync(backup)) renameSync(backup, target);
  }
  console.log(
    `${action === "link" ? "Linked local" : "Restored published"} taxes: ${pkg.name}`,
  );
}
