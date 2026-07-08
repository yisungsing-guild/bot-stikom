import sys, json

data = json.load(sys.stdin)

depth = 0
for tok in data:
    lab = tok['type']['label']
    if lab == '{':
        depth += 1
    elif lab == '}':
        depth -= 1
        if depth < 0:
            print('NEGATIVE', tok['loc']['start']['line'], tok['loc']['start']['column'])
            sys.exit(1)

print('END', depth)
