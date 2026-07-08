from pathlib import Path
lines = Path('src/routes/provider.js').read_text(encoding='utf8').splitlines()
for ln in [1092,1093,1094,1095,1096,1097,1098,1099,1100]:
    s = lines[ln-1]
    print(ln, repr(s), [ord(c) for c in s])
