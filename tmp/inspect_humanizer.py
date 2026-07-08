from pathlib import Path
import re

p = Path('src/engine/humanizer.js')
text = p.read_text(encoding='utf-8')
pattern = re.compile(r'/Balas(?:\\s\+saja)?\\s*:\\s*\[\^\n\]\*\\n\?/gi,', re.MULTILINE)
match = pattern.search(text)
print('match', bool(match))
if match:
    print(repr(match.group(0)))
else:
    idx = text.find('/Balas(?:\\s+saja)?\\s*:\\s*[^')
    print('idx', idx)
    if idx >= 0:
        print('snippet', repr(text[idx:idx+80]))
