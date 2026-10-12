import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readlinkSync,
  rmSync,
  cpSync,
  existsSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import test from "node:test";

const source = resolve(import.meta.dirname, "..");
function fixture(t, services = ["frontend", "api", "taxes"]) {
  const root = mkdtempSync(join(tmpdir(), "oc-turbo-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(join(source, "package.json"), join(root, "package.json"));
  cpSync(join(source, "turbo.json"), join(root, "turbo.json"));
  mkdirSync(join(root, "scripts/tooling"), { recursive: true });
  cpSync(
    join(source, "scripts/tooling/package-lock.json"),
    join(root, "scripts/tooling/package-lock.json"),
  );
  symlinkSync(
    join(source, "scripts/tooling/node_modules"),
    join(root, "scripts/tooling/node_modules"),
    "dir",
  );
  cpSync(join(source, "scripts/turbo.mjs"), join(root, "scripts/turbo.mjs"));
  const git = (cwd, ...args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  for (const short of services) {
    const directory = join(root, `opencollective-${short}`);
    mkdirSync(directory);
    const name =
      short === "taxes" ? "@opencollective/taxes" : `opencollective-${short}`;
    const pkg = {
      name,
      version: "1.0.0",
      private: true,
      packageManager: "npm@11.19.0",
      scripts: {
        build: "node build.cjs",
        "build:compile": "node build.cjs",
        "build:clean":
          "node -e \"require('fs').rmSync('dist',{recursive:true,force:true})\"",
        dev: "node dev.cjs",
        "dev:environment": `EXTRA_ENV="$OC_DEV_ENV_${short.toUpperCase()}" node dev.cjs`,
        test: "node args.cjs",
      },
    };
    writeFileSync(join(directory, "package.json"), JSON.stringify(pkg));
    writeFileSync(
      join(directory, "package-lock.json"),
      JSON.stringify({
        name,
        lockfileVersion: 3,
        packages: { "": { name, version: "1.0.0" } },
      }),
    );
    writeFileSync(join(directory, "source.txt"), "first");
    writeFileSync(
      join(directory, ".gitignore"),
      "dist/\nnode_modules/\n.turbo/\n.env*\n",
    );
    writeFileSync(
      join(directory, "build.cjs"),
      `const fs=require('fs');fs.mkdirSync('dist',{recursive:true});fs.mkdirSync('.turbo',{recursive:true});fs.appendFileSync('.turbo/runs','x');fs.writeFileSync('dist/index.js',fs.readFileSync('source.txt','utf8')+process.env.BUILD_VARIANT);`,
    );
    writeFileSync(
      join(directory, "dev.cjs"),
      `require('fs').mkdirSync('.turbo',{recursive:true});require('fs').writeFileSync('.turbo/pid',String(process.pid));console.log(process.env.EXTRA_ENV||'default');setInterval(()=>{},1000);`,
    );
    writeFileSync(
      join(directory, "args.cjs"),
      `console.log(JSON.stringify(process.argv.slice(2)));`,
    );
    const tasks = {
      build: {
        cache: true,
        outputs: ["dist/**"],
        inputs: ["$TURBO_DEFAULT$", ".env*", "!dist/**", "!.turbo/**"],
        env: ["BUILD_VARIANT", "OC_LOCKFILE_HASH_FRONTEND"],
      },
      dev: { persistent: true, cache: false, passThroughEnv: ["*"] },
      "dev:environment": {
        persistent: true,
        cache: false,
        passThroughEnv: ["*"],
      },
      test: { cache: false, passThroughEnv: ["*"] },
    };
    tasks["build:compile"] = { ...tasks.build, dependsOn: ["build:clean"] };
    tasks["build:clean"] = { cache: false, passThroughEnv: ["*"] };
    writeFileSync(
      join(directory, "turbo.json"),
      JSON.stringify({ extends: ["//"], tasks }),
    );
    git(directory, "init", "-q");
    git(directory, "add", ".");
    git(
      directory,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "fixture",
    );
  }
  git(root, "init", "-q");
  writeFileSync(
    join(root, ".gitignore"),
    "node_modules\n.turbo\npackage-lock.json\n",
  );
  git(root, "add", ".");
  git(
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "fixture",
  );
  const env = {
    ...process.env,
    OC_MONOREPO_ROOT: root,
    TURBO_TOKEN: "",
    TURBO_TEAM: "",
    BUILD_VARIANT: "a",
  };
  const run = (...args) =>
    spawnSync(process.execPath, [join(root, "scripts/turbo.mjs"), ...args], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 20000,
    });
  return { root, env, run };
}

test("partial checkout selects default services and isolates environments", (t) => {
  const { run } = fixture(t);
  let result = run("dev", "frontend:staging", "api", "--dry=json");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(result.stdout).tasks.map((task) => task.taskId),
    ["opencollective-api#dev", "opencollective-frontend#dev:environment"],
  );
  result = run("dev", "--dry=json");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(result.stdout).tasks.map((task) => task.taskId),
    ["opencollective-api#dev", "opencollective-frontend#dev"],
  );
  assert.notEqual(run("dev", "unknown").status, 0);
  assert.notEqual(run("dev", "frontend:", "--dry=json").status, 0);
  assert.match(run("dev", "--background").stderr, /Detached mode was removed/);
});

test("cache restores artifacts and invalidates nested-repository source, lockfile, and environment changes", (t) => {
  const { root, env, run } = fixture(t, ["frontend"]);
  const dir = join(root, "opencollective-frontend");
  const build = () => {
    const result = run("build");
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  build();
  rmSync(join(dir, "dist"), { recursive: true });
  build();
  assert.equal(readFileSync(join(dir, ".turbo/runs"), "utf8"), "x");
  assert.equal(readFileSync(join(dir, "dist/index.js"), "utf8"), "firsta");
  writeFileSync(join(dir, "dist/stale.js"), "old source tree");
  build();
  assert.equal(existsSync(join(dir, "dist/stale.js")), false);
  assert.equal(readFileSync(join(dir, ".turbo/runs"), "utf8"), "x");
  writeFileSync(join(dir, "source.txt"), "second");
  build();
  assert.equal(readFileSync(join(dir, ".turbo/runs"), "utf8"), "xx");
  writeFileSync(
    join(dir, "package-lock.json"),
    readFileSync(join(dir, "package-lock.json"), "utf8") + "\n",
  );
  build();
  env.BUILD_VARIANT = "b";
  build();
  assert.equal(readFileSync(join(dir, ".turbo/runs"), "utf8"), "xxxx");
  assert.equal(readFileSync(join(dir, "dist/index.js"), "utf8"), "secondb");
  writeFileSync(join(dir, ".env.local"), "EXAMPLE=value");
  build();
  assert.equal(readFileSync(join(dir, ".turbo/runs"), "utf8"), "xxxxx");
});

test("test arguments remain separate and task failures propagate", (t) => {
  const { root, run } = fixture(t, ["frontend"]);
  const result = run(
    "test",
    "frontend",
    "--",
    "test/a file.test.ts",
    "--runInBand",
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\["test\/a file.test.ts","--runInBand"\]/);
  writeFileSync(
    join(root, "opencollective-frontend/args.cjs"),
    "process.exit(7)",
  );
  assert.notEqual(run("test", "frontend").status, 0);
});

function adoptEntrypoints(root, short) {
  const directory = join(root, `opencollective-${short}`);
  const manifest = join(directory, "package.json");
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  const config = JSON.parse(
    readFileSync(join(directory, "turbo.json"), "utf8"),
  );
  for (const task of ["dev", "test"]) {
    pkg.scripts[`${task}:task`] = pkg.scripts[task];
    pkg.scripts[task] = `npm run turbo -- run ${task}:task --`;
    config.tasks[`${task}:task`] = config.tasks[task];
    delete config.tasks[task];
  }
  pkg.scripts.turbo =
    "turbo --skip-infer --single-package --root-turbo-json=turbo.standalone.json";
  writeFileSync(manifest, JSON.stringify(pkg));
  writeFileSync(join(directory, "turbo.json"), JSON.stringify(config));
  writeFileSync(
    join(directory, "turbo.standalone.json"),
    JSON.stringify({ tasks: config.tasks }),
  );
  symlinkSync(
    join(root, "scripts/tooling/node_modules"),
    join(directory, "node_modules"),
    "dir",
  );
  return directory;
}

test("workspace schedules underlying service tasks and preserves runner arguments", (t) => {
  const { root, run } = fixture(t, ["frontend"]);
  const directory = adoptEntrypoints(root, "frontend");
  const result = run(
    "test",
    "frontend",
    "--",
    "test/a file.test.ts",
    "--runInBand",
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /\["test\/a file.test.ts","--runInBand"\]/);
  assert.match(result.stdout, /test:task/);
  writeFileSync(join(directory, "args.cjs"), "process.exit(7)");
  assert.notEqual(run("test", "frontend").status, 0);
});

test("service npm commands run inside a parent workspace and forward runner arguments", (t) => {
  const { root, env } = fixture(t, ["frontend"]);
  const directory = adoptEntrypoints(root, "frontend");
  const result = spawnSync(
    "npm",
    ["test", "--", "test/a file.test.ts", "--runInBand"],
    {
      cwd: directory,
      env,
      encoding: "utf8",
      timeout: 20000,
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /test:task/);
  assert.match(result.stdout, /\["test\/a file.test.ts","--runInBand"\]/);
});

test("native workspace task aliases preserve filtering and qualified task selection", (t) => {
  const { root, run } = fixture(t, ["frontend", "api"]);
  adoptEntrypoints(root, "frontend");
  adoptEntrypoints(root, "api");
  let result = run("run", "test", "--filter=opencollective-api", "--dry=json");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(
    JSON.parse(result.stdout).tasks.map((task) => task.taskId),
    ["opencollective-api#test:task"],
  );
  result = run("run", "opencollective-frontend#test", "--dry=json");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(
    JSON.parse(result.stdout).tasks.map((task) => task.taskId),
    ["opencollective-frontend#test:task"],
  );
});

test("terminating a foreground session stops its service process", async (t) => {
  const { root, env } = fixture(t, ["frontend"]);
  const child = spawn(
    process.execPath,
    [join(root, "scripts/turbo.mjs"), "dev", "frontend"],
    { cwd: root, env, stdio: "ignore" },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });
  const pidFile = join(root, "opencollective-frontend/.turbo/pid");
  for (let attempt = 0; attempt < 100 && !existsSync(pidFile); attempt++)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(existsSync(pidFile));
  const pid = Number(readFileSync(pidFile, "utf8"));
  child.kill("SIGTERM");
  await new Promise((resolve, reject) => {
    child.once("close", resolve);
    setTimeout(() => reject(new Error("Turbo did not stop")), 5000).unref();
  });
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("ordinary commands preserve manually linked taxes without building or relinking it", (t) => {
  const { root, run } = fixture(t);
  const taxes = join(root, "opencollective-taxes");
  const links = ["frontend", "api"].map((short) => {
    const scope = join(
      root,
      `opencollective-${short}/node_modules/@opencollective`,
    );
    mkdirSync(scope, { recursive: true });
    const link = join(scope, "taxes");
    symlinkSync(taxes, link, "dir");
    return link;
  });
  let result = run("dev", "--dry=json");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(
    JSON.parse(result.stdout).tasks.map((task) => task.taskId),
    ["opencollective-api#dev", "opencollective-frontend#dev"],
  );
  result = run("build", "frontend", "--cache=local:,remote:");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const link of links) assert.equal(readlinkSync(link), taxes);
  assert.equal(existsSync(join(taxes, ".turbo/runs")), false);
});
