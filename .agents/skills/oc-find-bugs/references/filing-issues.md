# Filing confirmed bugs

Applies only to bugs the operator approved in step 5, with their approved destination and edits. Use `gh` with an explicit `--repo` on every command. Write each body to a file under `priv/find-bugs/<run-id>/issues/` and pass `--body-file`.

## Dedup first

For each bug, search both repos, open and closed, by file, function and distinctive terms:

```bash
for repo in opencollective/opencollective opencollective/opencollective-security; do
  gh search issues --repo "$repo" --include-prs "<function or symptom>" --json repository,number,title,state,url
done
```

For security bugs, also search for the fingerprint (below) and follow the **Dedup** section of [OC-OVERLAY.md](../../security-audit/OC-OVERLAY.md). A match goes back to the operator: comment on the existing issue with the new evidence, or file anyway. A closed match is a candidate regression; say so.

## Regular bugs → `opencollective/opencollective`

Public. Classify with **Classify each issue** in [oc-triage](../../oc-triage/SKILL.md): native type **Bug**, the service label (`api`, `frontend`, `pdf`, `rest`, `images`, `tax`), every matching topic label (`expenses`, `ledger`, `payment-methods`, `accounting`, `invoices`, ...), and one `complexity → *` label. Add `reviewed`: the hunt already did the triage. Use existing labels only; check with `gh label list --repo opencollective/opencollective --limit 300`.

Body:

````markdown
**Where:** `<service>/<path>:<line>` - `<function>` (commit `<sha>`)

**Input:** <the input or sequence of calls>

**Expected:** <what should happen, and the docstring, name or caller that promises it>

**Actual:** <what happens>

**Severity:** <High | Medium | Low>

<details><summary>Failing test</summary>

```ts
<the prover's test>
```

</details>

**Suggested fix:** <one or two sentences, plus the diff when short>
````

```bash
gh issue create --repo opencollective/opencollective --title "<short symptom in product terms>" \
  --body-file <file> --label "<service>" --label "<topic>" --label "complexity → simple" --label reviewed
gh issue edit <n> --repo opencollective/opencollective --type Bug
```

## Security bugs → `opencollective/opencollective-security`

Private. Never put security bugs, their tests or their exploit path in the public repo, a commit message, or a PR body.

Follow [OC-OVERLAY.md](../../security-audit/OC-OVERLAY.md) for the fingerprint (`oc:<repo>:<class>:<canonical-ref>`, first line of the body), the **Issue body template**, and the label rules. For this skill: Report ID `harness`, Reporter `oc-find-bugs`, the failing test inline or as the PoC path under `priv/find-bugs/<run-id>/`. Native type **Bug**; labels from the live list (`gh label list --repo opencollective/opencollective-security --limit 200`):

- `source > harness`
- `service > api` / `service > frontend` / `service > rest` / `service > pdf`
- matching `type > *` and `scope > *` (for example `type > permissions`, `type > privilege escalation`, `scope > payments`, `scope > ledger`, `scope > 2FA`)
- `severity > critical|high|medium|low` from the working severity, with the security impact weighed in (a Medium crash that lets anyone drain a balance is critical)

## Verify and report

Re-read each created issue (`gh issue view <n> --repo <repo> --json number,url,labels,issueType`) and fix missing labels or type. On a failed write, stop that issue, re-read remote state before retrying, and never post a duplicate. Report every issue as `owner/repo#number` with its link, plus anything skipped or failed.
