import {
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export function launcherIdentity(root) {
  return createHash("sha256").update(realpathSync(root)).digest("hex");
}

export function stateDirectory({ root, home, env, settings }) {
  if (env.XDG_STATE_HOME && !isAbsolute(env.XDG_STATE_HOME))
    throw new Error("XDG_STATE_HOME must be an absolute path");
  const directory = resolve(
    env.XDG_STATE_HOME || join(home, ".local/state"),
    "opencollective-vm",
    `${launcherIdentity(root).slice(0, 16)}-${settings.project}-${settings.instance_name}`,
  );
  let ancestor = directory;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const canonical = join(realpathSync(ancestor), relative(ancestor, directory));
  const inside = relative(realpathSync(root), canonical);
  if (!isAbsolute(inside) && inside !== ".." && !inside.startsWith("../"))
    throw new Error(
      "XDG_STATE_HOME must be outside the shared launcher checkout",
    );
  if (/[\r\n\x00]/.test(canonical))
    throw new Error("Host state path cannot contain line breaks");
  return canonical;
}

// Private files are replaced atomically so SSH never reads a partial config.
export function atomicWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.oc-vm-${randomUUID()}`);
  try {
    writeFileSync(temporary, content, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
