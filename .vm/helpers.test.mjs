// Repeatable guest stack setup against temporary files and fake service commands.
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createGuest, writeEnvDefaults } from "./guest.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "oc-helper-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "launcher");
  mkdirSync(root);
  return root;
}
test("environment defaults preserve exported user values and are idempotent", (t) => {
  const path = join(fixture(t), ".env");
  writeFileSync(path, "export API_URL=http://custom-api\n# User settings\n");
  const defaults = {
    API_URL: "http://localhost:3060",
    IMAGES_URL: "http://localhost:3001",
  };
  writeEnvDefaults(path, defaults);
  const content = readFileSync(path, "utf8");
  writeEnvDefaults(path, defaults);
  assert.equal(readFileSync(path, "utf8"), content);
  assert.ok(content.includes("export API_URL=http://custom-api"));
  assert.equal(content.match(/IMAGES_URL=/g).length, 1);
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("bootstrap accepts developer configuration and restores only an absent test database", async (t) => {
  for (const existing of [true, false]) {
    let databaseExists = existing;
    const root = fixture(t);
    for (const service of [
      "api",
      "frontend",
      "rest",
      "pdf",
      "images",
      "taxes",
    ]) {
      mkdirSync(join(root, `opencollective-${service}`));
      writeFileSync(join(root, `opencollective-${service}/package.json`), "{}");
    }
    const config = join(root, "opencollective-api/.env");
    const overrides =
      "PG_URL=postgres://developer@custom.example/dev\nAWS_S3_ENDPOINT=https://custom-storage.example\nOC_ENV=custom\n";
    writeFileSync(config, overrides);
    const calls = [];
    const guest = createGuest({
      root,
      env: { OC_ENV: "custom" },
      output: () => {},
      wait: () => assert.fail("Ready dependencies should not wait"),
      // Database and storage operations are mocked; these tests never contact
      // the custom endpoints and exercise both persistent-database branches.
      run: (args, options) => {
        calls.push({ args, options });
        if (args.includes("db:restore:test")) databaseExists = true;
        return {
          status: 0,
          stdout: args[0] === "psql" && databaseExists ? "1\n" : "",
        };
      },
    });
    await guest.stack();
    const content = readFileSync(config, "utf8");
    assert.ok(content.startsWith(overrides));
    await guest.stack();
    assert.equal(readFileSync(config, "utf8"), content);
    assert.equal(
      calls.some(({ args }) => args[0] === "git" && args[1] === "config"),
      false,
    );
    const startup = calls[0];
    assert.deepEqual(startup.args.slice(2), [
      "--engine",
      "docker",
      "--detach",
      "db",
      "mail",
      "uploads",
    ]);
    assert.equal(startup.options.env.COMPOSE_PROJECT_NAME, "oc-development");
    assert.equal(
      calls.filter(({ args }) => args.includes("db:restore:test")).length,
      existing ? 0 : 1,
    );
  }
});

test("missing service stops stack setup before commands or workspace writes", async (t) => {
  const root = fixture(t);
  await assert.rejects(
    createGuest({
      root,
      run: () => assert.fail("No commands should run"),
    }).stack(),
    /prepare this service in the host checkout/,
  );
  assert.equal(existsSync(join(root, "opencollective-api")), false);
});
