from pathlib import Path
import sys
text = Path('src/routes/provider.js').read_text('utf8').splitlines()
line = int(sys.argv[1]) if len(sys.argv) > 1 else 1
print(text[line-1])
print(''.join(f'{i}:{ch} ' for i, ch in enumerate(text[line-1], start=1) if 60 <= i <= 85))
