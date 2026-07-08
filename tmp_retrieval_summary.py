import json
from pathlib import Path
arr = json.loads(Path('tmp_retrieval_diagnostics.json').read_text(encoding='utf8'))
lines = []
for o in arr:
    lines.append(f'QUERY: {o["query"]}')
    for idx, t in enumerate(o['top10'][:10], start=1):
        lines.append(f"  {idx:2}. {t['filename'][:55]:55} | {t['docCategory'] or 'NONE':9} | {t['chunkType']:8} | comp={t['compositeScore']:.3f}")
    lines.append('')
Path('tmp_retrieval_top10_summary.txt').write_text('\n'.join(lines), encoding='utf8')
