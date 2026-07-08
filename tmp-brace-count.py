import re
from pathlib import Path
text = Path('src/routes/provider.js').read_text(encoding='utf8')
lines = text.splitlines()
start = 788
end = 1092
snippet = '\n'.join(lines[start:end])
# Remove strings and comments approximately.
snippet = re.sub(r"'(?:\\.|[^'\\])*'", ' ', snippet)
snippet = re.sub(r'"(?:\\.|[^"\\])*"', ' ', snippet)
snippet = re.sub(r'`(?:\\.|[^`\\])*`', ' ', snippet)
snippet = re.sub(r'//.*?$|/\*[\s\S]*?\*/', lambda m: ' ' * len(m.group(0)), snippet, flags=re.MULTILINE)
brace = 0
for i, line in enumerate(snippet.splitlines(), start=start+1):
    for ch in line:
        if ch == '{':
            brace += 1
        elif ch == '}':
            brace -= 1
    print(f'{i}: brace={brace} line={line!r}')
print('final brace', brace)
