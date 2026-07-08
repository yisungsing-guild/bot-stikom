import sys, json
from pathlib import Path
line_no = int(sys.argv[1])

data = json.load(sys.stdin)
for tok in data:
    if tok['loc']['start']['line'] == line_no:
        print(tok['type']['label'], tok.get('value'), tok['loc'])
