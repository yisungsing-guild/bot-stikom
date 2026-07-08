from pathlib import Path
text = Path('src/engine/humanizer.js').read_text(encoding='utf-8')
i = text.find('/Balas(?:\\s+saja)?\\s*:\\s*[^')
for offset in range(0, 30):
    ch = text[i+offset]
    print(offset, repr(ch), ord(ch))
