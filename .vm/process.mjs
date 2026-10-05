import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Execute argument arrays directly: no host shell interpolation or credential logging.
// Inherit terminal input for interactive guest authentication and SSH prompts.
// capture collects stdout only; quiet also captures stderr for readiness probes.
export function command(
  args,
  { check = true, capture = false, quiet = false, ...options } = {},
) {
  const result = spawnSync(args[0], args.slice(1), {
    encoding: "utf8",
    stdio: quiet
      ? ["inherit", "pipe", "pipe"]
      : capture
        ? ["inherit", "pipe", "inherit"]
        : "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (check && result.status !== 0)
    throw new Error(
      `${args[0]} failed (exit ${result.status ?? result.signal})`,
    );
  return result;
}

// SSH joins remote arguments into shell text. Quoting each argument here prevents
// expansion on the guest while preserving spaces and literal apostrophes.
export function shellQuote(value) {
  return /^[a-zA-Z0-9_@%+=:,./-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

export function isMain(url) {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(url);
}

// Imported helpers remain side-effect free for tests. CLI entry points share a
// short error message and nonzero exit status without dumping command arguments.
export async function main(action) {
  try {
    await action();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
