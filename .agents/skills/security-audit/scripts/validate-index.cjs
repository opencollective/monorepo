#!/usr/bin/env node

/**
 * Validates harness/index.json against schemas/index.schema.json.
 * Usage: node validate-index.cjs <path-to-index.json>
 *
 * Uses the dependency-free schema interpreter in validate-findings.cjs, plus
 * index-specific uniqueness checks.
 */

const fs = require("node:fs");
const path = require("node:path");
const {
  LIMITS,
  collect,
  collectSchemaErrors,
} = require("../validate-findings.cjs");

const INDEX_SCHEMA_PATH = path.join(__dirname, "..", "schemas", "index.schema.json");
const META_SCHEMA_PATH = path.join(__dirname, "..", "schemas", "report-meta.schema.json");
const MAX_INPUT_BYTES = LIMITS.inputBytes;

function loadSchema(schemaPath) {
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const errors = collectSchemaErrors(schema);
  if (errors.length > 0) {
    throw new Error(`unsupported or invalid schema ${schemaPath}:\n${errors.join("\n")}`);
  }
  return schema;
}

function readJsonFile(file, maxBytes = MAX_INPUT_BYTES) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error("input must be a regular file");
  if (stat.size > maxBytes) throw new Error(`input exceeds ${maxBytes} byte limit`);
  const contents = fs.readFileSync(file, "utf8");
  if (Buffer.byteLength(contents) > maxBytes) {
    throw new Error(`input exceeds ${maxBytes} byte limit`);
  }
  return JSON.parse(contents);
}

function collectIndexSemanticErrors(data) {
  const errors = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) return errors;
  if (!Array.isArray(data.findings)) return errors;

  const fingerprints = new Map();
  data.findings.forEach((finding, index) => {
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) return;
    if (typeof finding.fingerprint !== "string") return;
    if (fingerprints.has(finding.fingerprint)) {
      errors.push(
        `$.findings[${index}].fingerprint: duplicate of $.findings[${fingerprints.get(finding.fingerprint)}].fingerprint`,
      );
    } else {
      fingerprints.set(finding.fingerprint, index);
    }
  });
  return errors;
}

function validateAgainstSchema(data, schema) {
  const schemaErrors = collectSchemaErrors(schema);
  if (schemaErrors.length > 0) return schemaErrors;
  return collect(data, schema, "$");
}

function validateIndex(data, schema) {
  const loaded = schema || loadSchema(INDEX_SCHEMA_PATH);
  const errors = validateAgainstSchema(data, loaded);
  if (errors.length < LIMITS.validationErrors) {
    errors.push(...collectIndexSemanticErrors(data));
  }
  return errors;
}

function validateMeta(data, schema) {
  const loaded = schema || loadSchema(META_SCHEMA_PATH);
  return validateAgainstSchema(data, loaded);
}

function printErrors(errors) {
  for (const message of errors) console.error("ERROR:", message);
}

function run(file) {
  if (!file) {
    console.error("Usage: node validate-index.cjs <path-to-index.json>");
    return 1;
  }

  let schema;
  try {
    schema = loadSchema(INDEX_SCHEMA_PATH);
  } catch (error) {
    console.error("Failed to load index.schema.json:", error.message);
    return 1;
  }

  let data;
  try {
    data = readJsonFile(file);
  } catch (error) {
    console.error("Failed to read index JSON:", error.message);
    return 1;
  }

  let errors;
  try {
    errors = validateIndex(data, schema);
  } catch (error) {
    console.error("Failed to validate index JSON:", error.message);
    return 1;
  }

  printErrors(errors);
  if (errors.length > 0) {
    const cap = errors.length === LIMITS.validationErrors ? `; output capped at ${LIMITS.validationErrors}` : "";
    console.error(`FAIL: ${errors.length} validation error(s)${cap}`);
    return 1;
  }

  const count = Array.isArray(data.findings) ? data.findings.length : 0;
  console.log(`PASS: ${count} findings in index`);
  return 0;
}

module.exports = {
  INDEX_SCHEMA_PATH,
  META_SCHEMA_PATH,
  collectIndexSemanticErrors,
  loadSchema,
  readJsonFile,
  validateAgainstSchema,
  validateIndex,
  validateMeta,
};

if (require.main === module) process.exit(run(process.argv[2]));
