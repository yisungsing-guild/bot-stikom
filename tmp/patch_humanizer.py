from pathlib import Path

p = Path('src/engine/humanizer.js')
text = p.read_text(encoding='utf-8')
for i, line in enumerate(text.splitlines(), 1):
    if 512 <= i <= 518:
        print(i, repr(line))
