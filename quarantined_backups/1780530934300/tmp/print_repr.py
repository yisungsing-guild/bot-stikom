from pathlib import Path
path = Path('tmp/provider_syntax_wrapper4.js')
lines = path.read_text(encoding='utf8').splitlines()
print(repr(lines[95]))
