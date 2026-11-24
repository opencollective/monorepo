# Security PRs and Dependabot alerts

Security bumps (`[security]` in the title, Dependabot alerts) come first in the batch and are never
closed for convenience. Dismissing an alert is the user's call, like closing a PR. Dependabot alerts
are disabled on contributors-svg.

## Dependabot security PRs go stale fast

Lockfile maintenance and other bumps often install the target version on main first. Compare each
PR's target with main's lockfile (`jq` over `.packages`, nested copies included); already satisfied
means close as outdated (a batch item).

## Alerts without a fixing PR

An alert with no PR, or none that fixes it, is traced to the package that pins the vulnerable copy:

```sh
bash "$SK/scripts/alerts.sh" [repo ...]    # ALERTS_UPSTREAM=0 skips the npm view lookups
```

It lists each open alert, every copy in the default branch's lockfile (dev or runtime, vulnerable or
not), the dependents that resolve to each vulnerable copy, and the range in their latest release.
Its vulnerable check is a version sort against the first patched version: confirm edge cases by hand.
Then, by case:

- **Upgrading the dependent fixes it** (its latest release takes the patched range): find or wait for
  that bump's PR, and name it in the report (frontend codegen 5 → 6 moves `@graphql-tools/utils` to
  `^12.0.3`, frontend #12477).
- **We own the dependent:** open an issue there (Hyperwatch → `ip-cidr` → `ip-address` 9,
  hyperwatch/hyperwatch#638, all five repos).
- **A third-party dependent that pins an old range and no longer gets releases** (api
  `sequelize-temporal` pins lodash `4.17.21`; rest `omit-deep-lodash` takes `~4.17.21`): propose an
  npm `overrides` entry when the patched version is semver-compatible (lodash 4.18), or a dismissal
  when our calls never reach the vulnerable code. Name the call sites either way. The user chooses.
- **Dev-only copy, or no patched release** (sprintf-js via `argparse` 1): report it with its scope and
  reach (a DoS in a lint or test tool); propose a dismissal only on the user's request.
