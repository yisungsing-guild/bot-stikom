import json
from pathlib import Path
qs = ['berapa biaya MI','berapa biaya DNUI','berapa biaya HELP','berapa biaya UTB']
arr = json.loads(Path('tmp_retrieval_diagnostics.json').read_text(encoding='utf8'))
for q in qs:
    for o in arr:
        if o['query']==q:
            print('QUERY:', q)
            ec = o.get('exactCostResult', {})
            dbg = ec.get('debug') or {}
            fee = dbg.get('feeStruct') or o.get('feeStruct') or {}
            print(' feeStruct keys:')
            for k,v in (fee.items() if isinstance(fee, dict) else []):
                if k=='rawChunk':
                    s=str(v)
                    print('  rawChunk:', s[:400].replace('\n','\\n'))
                else:
                    print(' ',k,':', v)
            print(' stored feeStruct present in top-level:', bool(o.get('feeStruct')))
            print('---')
            break
