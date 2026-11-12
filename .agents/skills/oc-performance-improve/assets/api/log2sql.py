# usage: python3 -I log2sql.py <file>  -> runnable SQL
# <file> holds one Postgres log entry: the "LOG: duration ... execute <unnamed>: SQL" line and its "DETAIL: parameters: $1 = ..." line.
import re, sys
text = open(sys.argv[1]).read()
sql = re.search(r'execute <unnamed>: (.*?)\n', text).group(1)
m = re.search(r'parameters: (.*)', text)
params = dict(re.findall(r"\$(\d+) = ('(?:[^']|'')*'|NULL)", m.group(1))) if m else {}
sql = re.sub(r'\$(\d+)\b', lambda x: params[x.group(1)], sql)
print(sql + ';')
