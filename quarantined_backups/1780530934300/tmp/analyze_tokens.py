import json
from pathlib import Path

# Load Acorn tokenizer output from tmp/acorn-tokens.txt
text = Path('tmp/acorn-tokens.txt').read_text(encoding='utf8')
try:
    tokens = json.loads(text)
except json.JSONDecodeError as exc:
    print('JSON decode failed:', exc)
    raise

brace_depth = 0
paren_depth = 0
brace_positions = []
paren_positions = []
for tok in tokens:
    if not isinstance(tok, dict) or 'type' not in tok:
        continue
    label = tok['type'].get('label')
    if label == '{':
        brace_depth += 1
        brace_positions.append(('open', tok['start'], tok['end'], brace_depth))
    elif label == '}':
        brace_positions.append(('close', tok['start'], tok['end'], brace_depth))
        brace_depth -= 1
    elif label == '(':
        paren_depth += 1
        paren_positions.append(('open', tok['start'], tok['end'], paren_depth))
    elif label == ')':
        paren_positions.append(('close', tok['start'], tok['end'], paren_depth))
        paren_depth -= 1

print('final brace depth', brace_depth)
print('final paren depth', paren_depth)
print('last 10 brace positions:')
for item in brace_positions[-20:]:
    print(item)
print('last 10 paren positions:')
for item in paren_positions[-20:]:
    print(item)
