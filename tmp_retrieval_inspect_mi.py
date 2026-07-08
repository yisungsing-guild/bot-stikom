import json
from pathlib import Path
arr = json.loads(Path('tmp_retrieval_diagnostics.json').read_text(encoding='utf8'))
for o in arr:
    if o['query'] == 'berapa biaya MI':
        print(json.dumps({k: (v if k!='exactCostResult' else {'source': v.get('source'), 'feeStruct': bool(v.get('feeStruct')), 'debugKeys': list(v.get('debug', {}).keys()) if v.get('debug') else None}) for k,v in o.items() if k!='normalized'}, indent=2))
        break
