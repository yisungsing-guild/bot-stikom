from pathlib import Path
text = Path('src/routes/provider.js').read_text(encoding='utf-8', errors='replace')
lines = text.splitlines()
block = '\n'.join(lines[11490-1:11916])
Path('temp_block.js').write_text('async function temp() {\n' + block + '\n}', encoding='utf-8')
print('wrote temp_block.js')
