from pathlib import Path

p = Path('src/engine/ragEngine.js')
lines = p.read_text(encoding='utf8').splitlines()
replacements = {
    1606: "              source: 'rag-major-recommendation-hoby-doc-lines',",
    1628: "              source: 'rag-major-recommendation-hoby-doc-lex',",
    1653: "            source: 'rag-major-recommendation-hoby-doc',",
}
for idx, label in replacements.items():
    print('Replacing line', idx + 1, 'from', lines[idx])
    lines[idx] = label
p.write_text('\n'.join(lines) + '\n', encoding='utf8')
print('patched', p)
