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
            fee = dbg.get('feeStruct') or o.get('feeStruct') or None
            contexts = ec.get('contexts') or o.get('contexts') or []
            print(' rawChunk:')
            raw = None
            if fee and fee.get('rawChunk'):
                raw = fee.get('rawChunk')
            elif contexts and len(contexts):
                raw = contexts[0].get('chunk') or contexts[0].get('chunkPreview') or contexts[0]
            if raw:
                s = str(raw)
                print('  ', s if len(s) < 800 else s[:800] + '...')
            else:
                print('   (no chunk)')
            print(' parseFeeStructureFromChunk (pre-patch debug.feeStruct):')
            print(json.dumps(fee, indent=2, ensure_ascii=False))
            print(' parseFeeStructure(...) result (as stored):', 'feeStruct present' if o.get('feeStruct') else 'null or absent')
            print('---')
            break
