import json

tokens=json.load(open('tmp/acorn-tokens.txt', 'r', encoding='utf8'))
depth=0
neg=None
for tok in tokens:
    t = tok.get('type')
    if t and t.get('label') == '{':
        depth += 1
    elif t and t.get('label') == '}':
        depth -= 1
        if depth < 0 and neg is None:
            neg = (tok['start'], tok['end'])
            break

print('final depth', depth)
print('negative', neg)
