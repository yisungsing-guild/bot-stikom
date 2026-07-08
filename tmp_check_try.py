from pathlib import Path
p = Path('src/routes/provider.js')
lines = p.read_text(encoding='utf8').splitlines()
count = 0
for i, line in enumerate(lines, start=1):
    open_braces = line.count('{')
    close_braces = line.count('}')
    count += open_braces - close_braces
    if i >= 760 and i <= 1100:
        if 'try {' in line or '} catch' in line:
            print(f'{i}: count={count} line={line}')
