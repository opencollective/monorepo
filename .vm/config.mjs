// Environment-only defaults for project onboarding. Runtime state belongs to msb.
export const DEFAULTS = Object.freeze({
  cpus: 8,
  memory_mb: 43008,
  disk_gb: 100, // Docker's owned data disk, not the sandbox root.
  instance_name: "oc-dev",
  image: "ghcr.io/superradcompany/ubuntu-systemd:24.04",
});

export function loadSettings(env = process.env) {
  const settings = Object.fromEntries(
    Object.entries(DEFAULTS).map(([key, value]) => [
      key,
      env[`OC_VM_${key.toUpperCase()}`] ?? value,
    ]),
  );
  for (const key of ["cpus", "memory_mb", "disk_gb"]) {
    const value = settings[key];
    if (
      !/^\d+$/.test(String(value)) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) <= 0
    )
      throw new Error(`${key} must be a positive integer`);
    settings[key] = Number(value);
  }
  if (settings.cpus > 255) throw new Error("cpus must be at most 255");
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,62}$/.test(settings.instance_name))
    throw new Error("Invalid instance_name");
  if (
    typeof settings.image !== "string" ||
    !settings.image ||
    /[\s\x00]/.test(settings.image) ||
    /^[./-]/.test(settings.image)
  )
    throw new Error("image must be an OCI image reference");
  return settings;
}
