# Host notes: Codex, Claude Code, zsh, scratch worktrees

Codex discovers this repository skill under `.agents/skills/package-updates`; `agents/openai.yaml`
supplies its UI metadata. The shared instructions stay independent of Claude-only tool names or
directories.

## Long waits and background commands

- Long waits use the host's background or yielded-process mechanism. A foreground tool call usually
  times out well before CI finishes (10 minutes for a Claude Code sub-agent), so `cycle.sh` always
  runs in the background.
- Redirect to a log and echo the exit code: `… > "$S/cycle-api.log" 2>&1; echo "exit $?"`. Piped
  through `tail`, the task reports tail's exit 0 even when a PR is RED.
- **Codex:** start the command with a short `exec_command` yield, then use `write_stdin` with its
  session ID; if the orchestration tool itself yields a cell ID, resume it with `functions.wait`. Keep
  individual waits under 60 s and give concise progress updates during long CI or review runs.

## Asking for approval

Use a question tool only if it supports approval requests in the current mode; otherwise ask in the
final message. Codex's Plan-mode `request_user_input` is not an approval tool.

## zsh

The user's shell may be zsh:

- An unquoted `$var` does not word-split: loop with `bash -c`.
- `$H:refs/...` applies the `:r` modifier: brace every variable next to a colon,
  `"${H}:refs/heads/<branch>"`.
- A line starting with `=` (`echo ======` as a separator) fails with "= not found": use `echo ----`.

## Scratch worktrees

- Install with `npm ci --ignore-scripts`: a `prepare` script (husky 9) writes `core.hooksPath` into
  the git config the worktree shares with the user's checkout, which silently disables their hooks
  there. If it happened, `git config --unset core.hooksPath` in that repo.
- The scratch path depends on `SCRATCH` and `TMPDIR`, not on which agent is running, so worktrees
  left by another host's session show up in `git worktree list`.
- **Claude Code:** keep `S=$TMPDIR/package-updates` and never point `SCRATCH` at the per-session
  scratchpad. The review cache, claims and the previous session file live in `$S`, and a fresh
  scratchpad hides them (2026-11-24: a cached Hyperwatch digest was missed until `S` moved back).
- A probe run from a repo worktree loads that repo's packages with
  `require(require.resolve('<pkg>', { paths: [process.cwd()] }))`.
- The non-interactive shell may pick Node 20 from nvm: prefix with `use_repo_node` from
  `scripts/_lib.sh` (the major in the repo's `.nvmrc` on main; `use_node <major>` for another) and verify `node --version`
  / `npm --version` before `npm ci`, `tsc` or tests.
