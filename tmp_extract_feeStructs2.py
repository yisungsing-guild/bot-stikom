import json
from pathlib import Path
qs = ['berapa biaya TI gelombang 1A','berapa biaya TI gelombang 2C','berapa biaya SI gelombang 2C','berapa biaya SK gelombang 1A']
arr = json.loads(Path('tmp_retrieval_diagnostics.json').read_text(encoding='utf8'))
out = {}
for q in qs:
    for o in arr:
        if o['query']==q:
            fs = o.get('exactCostResult', {}).get('debug', {}).get('feeStruct') or o.get('feeStruct') or o.get('exactCostResult', {})
            if fs is None:
                out[q]=None
            else:
                keys = ['program','programName','wave','waveGroup','academicYear','sourceFile','updatedAt','registrationFee','dpp','dppDiscount','registrationDiscount','ukt','scholarship','isGlobalDiscount','rawChunk']
                out[q] = {k: fs.get(k) if isinstance(fs, dict) else fs for k in keys} if isinstance(fs, dict) else fs
            break
print(json.dumps(out, indent=2, ensure_ascii=False))
