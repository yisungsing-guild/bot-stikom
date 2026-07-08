from pathlib import Path
p = Path('src/engine/humanizer.js')
text = p.read_text(encoding='utf-8')
lines = text.splitlines()
for i in range(510, 520):
    print(i+1, repr(lines[i]))
print('line 516 contains actual newline? no, splitlines removed it')
