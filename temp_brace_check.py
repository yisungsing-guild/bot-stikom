from pathlib import Path
path = Path('src/routes/provider.js')
text = path.read_text(encoding='utf-8', errors='replace')
lines = text.splitlines()
count = 0
for i, line in enumerate(lines, start=1):
    for ch in line:
        if ch == '{':
            count += 1
        elif ch == '}':
            count -= 1
    if 11590 <= i <= 11920:
        print(f'{i:5} count={count} | {line}')
print('final', count)
