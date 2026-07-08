import json
from pathlib import Path
arr=json.loads(Path('tmp_retrieval_diagnostics.json').read_text(encoding='utf8'))
for o in arr:
    if o['query']=='berapa biaya MI':
        print(json.dumps(o, indent=2, ensure_ascii=False)[:20000])
        break
