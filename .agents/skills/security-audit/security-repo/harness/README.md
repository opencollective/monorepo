# Harness

Long-term security index for Open Collective. Canonical location: this repository.

## `index.json`

Unified findings index. Schema: `opencollective` monorepo `.agents/skills/security-audit/schemas/index.schema.json`.

- Start empty.
- Patch by fingerprint only: `node scripts/patch-index.cjs --mode hunt|bounty|internal --index harness/index.json ...`
- Hunt owns source `harness`, paths, `commitSha`, `lastSeen`, and may set `issue` / `verdict`. Hunt must not rewrite `reports[]` or delete rows.
- Bounty / internal ingest own `reports[]` and add their source. They must not clear hunt fields (`paths`, `commitSha`).
- Validate after every write: `node scripts/validate-index.cjs harness/index.json`

Optional reporter grouping (stdout markdown):

```
node .agents/skills/security-audit/scripts/generate-index-readme.cjs --index harness/index.json
```

Fingerprint format: `oc:<service>:<class>:<slug>` matching `^oc:[a-z]+:[a-z0-9-]+:.+` (example: `oc:api:idor:edit-expense-payout`). Embed `<!-- oc-fingerprint: ... -->` in GitHub issue bodies.

## Coverage ledgers

Cloudflare `validate-coverage-ledger.cjs` accepts a top-level JSON **array** of coverage units. An empty array `[]` is valid.

- `harness/api/coverage-ledger.json` is an empty valid stub for `opencollective-api`.
- First hunt of another service should create `harness/<service>/coverage-ledger.json` the same way (`frontend`, `rest`, `pdf`, `images`). Do not change validator semantics to make a stub pass.

## `runs/`

Hunt outputs live outside the target checkout. Optional copies or pointers may be stored as:

```
harness/runs/<utc-date>-<repo>/
```

Keep secrets and exploit payloads out of this repository. Findings detail belongs in GitHub issues (fingerprint comment + `source > harness` or `source > bounty`).
