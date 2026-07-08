import json
rows=json.load(open('tmp/fast_audit_summary.json',encoding='utf-8'))
out=[]
for e in rows:
    chosen=e.get('bucketChosenByMapping')
    bw=e.get('bucketsWithChoice') or []
    if bw and chosen is None:
        cls='TARGET 1 (mapping)'
    elif not bw:
        cls='TARGET 3 (data-extraction)'
    elif chosen and chosen not in bw:
        cls='TARGET 2 (parser)'
    else:
        cls='UNDETERMINED'
    out.append({'chatId':e.get('chatId'),'choice':e.get('choice'),'programNormalized':e.get('programNormalized'),'bucketChosen':chosen,'bucketsWithChoice':bw,'classification':cls})
print(json.dumps(out,ensure_ascii=False,indent=2))
print('\nTOTAL:',len(out))
print('TARGET 1:',sum(1 for r in out if r['classification'].startswith('TARGET 1')))
print('TARGET 2:',sum(1 for r in out if r['classification'].startswith('TARGET 2')))
print('TARGET 3:',sum(1 for r in out if r['classification'].startswith('TARGET 3')))
