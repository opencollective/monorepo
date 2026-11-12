"""Turn a statement logged by Postgres (log_min_duration_statement) into SQL you can EXPLAIN.

usage: python3 -I pg-log-to-sql.py <file>

<file> holds the two log lines of one statement, as printed by
`docker logs <container> 2>&1 | grep -A1 '\\[<pid>\\] LOG:  duration: <ms>'`:

    ... LOG:  duration: 4735.1 ms  execute <unnamed>: SELECT ... WHERE "id" = $1
    ... DETAIL:  parameters: $1 = '42', $2 = NULL

Statements logged without parameters ("statement: SELECT ...") are printed as they are.
"""
import re
import sys

text = open(sys.argv[1]).read()
statement = re.search(r"(?:execute [^:]+|statement): (.*?)(?:\n|$)", text)
if not statement:
    sys.exit("No 'execute <name>:' or 'statement:' line found")
sql = statement.group(1).strip()
detail = re.search(r"parameters: (.*)", text)
params = dict(re.findall(r"\$(\d+) = ('(?:[^']|'')*'|NULL)", detail.group(1))) if detail else {}
sql = re.sub(r"\$(\d+)\b", lambda m: params.get(m.group(1), m.group(0)), sql)
print(sql.rstrip(";") + ";")
