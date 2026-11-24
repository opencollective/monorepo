# Reviews: own review, second agent, then the user

Every batch item gets two reviews, in this order. Both run in a reviewer sub-agent when the host has
one; "your own review" then means the reviewer's report as you checked it. Authorization for
pushing, resolving threads and "the usual" is in SKILL.md, Authorization.

## Reviewer sub-agent

- **Cache.** Before reading release notes, look for `$S/reviews/<package>@<from>-<to>.md` (`/` in
  scoped names becomes `+`): a range already reviewed, in another repo or an earlier session, is
  reused, and only the call-site check runs again for this repo. Each reviewer writes the
  release-notes part (breaking changes, each with its source link) there for the next one.
- **Brief:** repo, PR, head SHA (or worktree path and base for an unpushed fix), package range, the
  cache path and this file. Take each PR's "from" version from its own diff (`gh pr diff`), never from
  a sibling repo's PR for the same package: repos lag differently (2026-11-24, Hyperwatch "5.7.0→5.8.0"
  in four repos, pdf was on 5.4.0). It does the whole review for that item, read-only: the own-review
  checklist, then `ai-review.sh` (plus the local `codex review` where required below).
- **Quick-scanner digests** (SKILL.md, Delegation) write the same cache files; a reviewer that finds a
  digest uses it as a starting point and still spot-checks one breaking change against the source,
  since a digest is a summary, not evidence.
- **Repo slugs** in the brief come from `repo-facts.sh` (`opencollective/opencollective-<repo>`,
  except `opencollective/contributors-svg`); a guessed `opencollective-<repo>` fails for the latter.
- **Evidence** goes to `$S/reviews/<repo>-<pr>@<head>.md`: the breaking changes with the call sites
  and greps behind each verdict, what CI exercises on them, any differential probe (from a scratch
  worktree, never the user's checkout), and each AI finding with its thread id.
- **Report back short**, because every later orchestrator turn re-reads it: per PR the reviewed head
  SHA, the draft `Own review: …; AI review: …` batch line and the evidence path, then only the
  exceptions (a finding to integrate or dismiss, a needed fix, a head mismatch, a behaviour change
  worth telling the user).
- **When the head moves** (rebase, fix), resume the same reviewer on the new head: it re-checks the
  diff, not the release notes.
- **Check the report** before using it: the head SHA matches the live head, every "N/A" has its
  grep, nothing claims "no findings" without a reviewer that ran. Thin or unsupported evidence →
  resume the same reviewer with the question, or check it yourself.
- The reviewer's report is the own review, not the second-agent review: Codex, CodeRabbit and the
  other bots remain that. An accepted finding goes to a fixer (resume the PR's fixer if it has one);
  pushing and resolving the thread stay with the orchestrator, and the new head gets a new review.

## 1. Own review checklist

For every item, dependency-only bumps included. Green CI proves only what the tests exercise.

- Read the release notes for every version in the range, each intermediate major included, and list
  the breaking changes (removed or renamed APIs, changed defaults, ESM-only packages, `engines`,
  peer ranges).
- Check each one against our usage: grep the call sites, config files and scripts that touch the
  package, and the peers that must accept the new version. A breaking change with no call site is
  noted as not applicable, with the grep that shows it.
- Check what CI actually exercises on those call sites. When nothing does (stubbed in tests, behind a
  disabled flag, production-only install), compare old and new versions directly (a small probe, a
  differential run), or add a test that fails on the broken behaviour and passes on the fix.
- For lockfile changes, list the transitive packages that moved (`node "$SK/scripts/lockdiff.js"
  base.json head.json`) and check the ones in the runtime path (`fixing.md` §4h).
- For a fix commit, review its diff like any code change: correctness, scope, and the tests it adds.
- Frontend: when a package listed in `allowScripts` moves, lockfile-only bumps included, its
  `name@version` entry must move too (`fixing.md` §3): npm 11 ignores the list, so nothing fails
  until npm 12.
- A major's own review states each breaking change against the call sites, even when the AI review
  is skipped.

## 2. Second agent

```sh
bash "$SK/scripts/ai-review.sh" api 12197                 # Codex + CodeRabbit findings on the PR head (threads and review bodies)
bash "$SK/scripts/ai-review.sh" rest --worktree "$S/wt-rest-671" "Hyperwatch v5"   # unpushed fix: codex review --base origin/main
bash "$SK/scripts/ai-review.sh" api --resolve <thread-id>  # after a fix is committed and pushed for that thread; never a comment
```

**Who reviews what.**

- Codex and CodeRabbit usually review api and frontend PRs on every push. On images and rest the
  Codex connector reviews only when someone comments `@codex review` (the user posts it, not the
  agent); read its threads with `ai-review.sh`. Otherwise PRs get the local `codex review` in a
  worktree of the PR head. Unpushed fixes always get the local review.
- Not every push gets a bot review: a force-push can go unreviewed, and CodeRabbit skips bot PRs
  ("skip review" comment). `ai-review.sh` ends with a coverage line; "no bot review or verdict on
  this head" means run the local review on that head, or, for a diff limited to `package.json` and
  the lockfile, `AI review: none (no code change)`.
- On a repo with no bot reviewer (pdf, contributors-svg, rest and images without a `@codex review`),
  a diff limited to `package.json` and the lockfile skips the local `codex review`: it has no code to
  read, and the release notes check is the own review. Any code change, a compat commit included,
  gets the local review.
- Sentry's reviewer posts threads as `sentry`; `ai-review.sh` lists it with the other bots. A thread
  from a reviewer it does not know is still a finding: when GitHub shows unresolved threads the
  script did not print, list them with a direct GraphQL query and add the login to `BOTS`.

**Findings.** Each is either **integrated** (commit on the branch, rerun the checks, resolve the
thread) or **dismissed** with a one-line reason. Nothing is left unanswered, nothing is posted as a
comment. Verify bot findings against the installed package source before acting (`fixing.md` §5).

**Batch line**, both outcomes: `Own review: breaking changes N/A (no cy.exec, 2 Cypress.env calls
migrated); AI review: 2 findings, 1 fixed (date bounds), 1 dismissed (nit, constants already used)`.
Dependency-only bumps with no code change and no bot finding still carry their own review line, then
`AI review: none`. When no second agent is available: `AI review: unavailable`.

**Coverage and limits.**

- After integrating findings, review the new head. At most two automated review/fix cycles per item
  per session; then report remaining substantive findings and hold the merge.
- No findings does not prove a review ran: verify the reviewed SHA and report missing or incomplete
  coverage. Local reviews require committed, clean worktrees and report the reviewed head and base
  SHAs. A missing final verdict or truncated GitHub review history is incomplete coverage: inspect
  the transcript or paginate before reporting a completed review.
- `ai-review.sh --worktree` exits 2 when Codex stops early (usage limit, interruption): the batch line
  then says `AI review: pending (Codex limit until <time>)`, never `none`.
- **Codex model fallback.** If the configured model is refused ("model is not supported when using
  Codex with a ChatGPT account"), use the fallback the user already approved (`CODEX_MODEL=<model>`,
  e.g. from their memory or instructions); without one, stop and ask: never pick another model on
  your own, other models can cost much more. Do not edit `~/.codex/config.toml`.

## "Check feedback" on a PR ("the usual")

Read the open threads with `ai-review.sh`; verify each finding against the installed package source
and a live repro; fix with a test that fails on the current head and passes with the fix; push,
resolve the thread, wait for CI (`cycle.sh wait`) and present the green head. Review summaries and
`@codex review` comments are not threads and cannot be resolved.
