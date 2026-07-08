from pathlib import Path
path = Path('tmp/provider_syntax_wrapper4.js')
lines = path.read_text(encoding='utf8').splitlines()
for i in range(80, 111):
    print(f'{i+1}: {lines[i]}')

