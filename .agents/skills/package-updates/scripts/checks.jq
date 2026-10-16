# One interpretation for inventory, wait and merge. Ignore only pending advisory bots.
def advisory: (.name // .context // "") | test("^(CodeRabbit|Seer)( /.*)?$"; "i");
def pending: (.status // "COMPLETED") != "COMPLETED" or .state == "PENDING";
def successful: (.conclusion // .state) as $s | ["SUCCESS", "NEUTRAL", "SKIPPED"] | index($s) != null;
[.statusCheckRollup[]? | select((advisory and pending) | not)] as $checks
| {
    total: ($checks | length),
    pending: [$checks[] | select(pending) | (.name // .context)],
    failing: [$checks[] | select(pending | not) | select(successful | not) | (.name // .context)],
    passed: ([$checks[] | select((.conclusion // .state) == "SUCCESS")] | length)
  }
| . + {green: (.total > 0 and .passed > 0 and (.pending | length) == 0 and (.failing | length) == 0)}
