import json
from pathlib import Path

path = Path('.tmp_retrieval_results.json')
results = json.loads(path.read_text('utf8'))
lines = []
for r in results:
    lines.append(f"QUESTION: {r['question']}")
    lines.append(f" queryForRetrieval: {r['queryForRetrieval']}")
    lines.append(f" intent: {r['intent']} userIntent: {r['userIntent']}")
    lines.append(' top20 BEFORE filterRelevantChunks:')
    for i, s in enumerate(r['top20']):
        filename = s['item'].get('filename') or s['item'].get('trainingId') or 'unknown'
        lines.append(f"  {i+1}. {s['item']['id']} | {filename} | cat={s.get('docCategory')} score={s['score']:.4f} composite={s['compositeScore']:.4f} final={s['finalScore']:.4f}")
    lines.append(f" filterRelevantChunks count: {r['relevantCount']}")
    lines.append(' relevant IDs:')
    for item in r.get('relevantIds', [])[:10]:
        lines.append(f"  {item['rank']}. {item['id']} | {item['filename']} | cat={item['docCategory']} score={item['score']} composite={item['compositeScore']} final={item['finalScore']}")
    lines.append(f" afterRelevant count: {len(r.get('afterRelevantIds', []))}")
    lines.append(' afterRelevant IDs:')
    for item in r.get('afterRelevantIds', [])[:10]:
        lines.append(f"  {item['rank']}. {item['id']} | {item['filename']} | cat={item['docCategory']} score={item['score']} composite={item['compositeScore']} final={item['finalScore']}")
    lines.append(f" applyIntentAwareFilteringAndValidation count: {r['validatedCount']}")
    lines.append(' validated IDs:')
    for item in r.get('validatedIds', [])[:10]:
        lines.append(f"  {item['rank']}. {item['id']} | {item['filename']} | cat={item['docCategory']} score={item['score']} composite={item['compositeScore']} final={item['finalScore']}")
    lines.append(' rejected reason samples:')
    for item in r.get('rejected', [])[:10]:
        lines.append(f"  {item.get('chunkId')} reason={item.get('reason')} category={item.get('category') or item.get('allowed')} detail={item.get('detail')}")
    lines.append(f" final ranking count: {r['finalCount']}")
    lines.append(' final ranking top 20:')
    for item in r['filteredIds']:
        lines.append(f"  {item['rank']}. {item['id']} | {item['filename']} | cat={item['docCategory']} score={item['score']} composite={item['compositeScore']} final={item['finalScore']}")
    lines.append(' chunk 6631dfc1 trace: '+str(r['trace']))
    lines.append('---')
Path('.tmp_retrieval_summary2.txt').write_text('\n'.join(lines), 'utf8')
