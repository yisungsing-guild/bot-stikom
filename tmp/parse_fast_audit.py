import re, json

p='tmp/jest_fast_fee_debug_output3.txt'
with open(p,'r',encoding='utf-8',errors='ignore') as f:
    s=f.read()

# helper to extract block starting at a given brace index
def extract_block(s, start_idx):
    depth=0
    for i in range(start_idx, len(s)):
        c=s[i]
        if c=='{':
            depth+=1
        elif c=='}':
            depth-=1
            if depth==0:
                return s[start_idx:i+1]
    return None

fast_fee_debugs=[]
for m in re.finditer(r"\[FAST_FEE_DEBUG\]\s*\{", s):
    start = m.start()
    brace = s.find('{', start)
    raw = extract_block(s, brace)
    if not raw:
        continue
    try:
        obj=json.loads(raw)
    except Exception:
        # skip if cannot parse
        continue
    fast_fee_debugs.append((start, obj))

fast_audits=[]
for m in re.finditer(r"\[FAST_AUDIT\]\s*\{", s):
    start = m.start()
    brace = s.find('{', start)
    raw = extract_block(s, brace)
    if not raw:
        continue
    block=raw
    def find_str(key):
        mm=re.search(key+":\s*'([^']*)'", block)
        return mm.group(1) if mm else None
    def find_bool(key):
        mm=re.search(key+":\s*(true|false)", block)
        return (mm.group(1)=='true') if mm else None
    chatId=find_str('chatId')
    routeText=find_str('routeText')
    allowBundledIndex=find_bool('allowBundledIndex')
    allowFast=find_bool('allowFast')
    hasBundleData=find_bool('hasBundleData')
    fastAnswerFound=find_bool('fastAnswerFound')
    fast_audits.append({'start':start,'chatId':chatId,'routeText':routeText,'allowBundledIndex':allowBundledIndex,'allowFast':allowFast,'hasBundleData':hasBundleData,'fastAnswerFound':fastAnswerFound,'raw':block})

out=[]
for a in fast_audits:
    if not (a['allowBundledIndex'] and a['allowFast'] and a['hasBundleData'] and a['fastAnswerFound'] is False):
        continue
    dbg=None
    for start,obj in reversed(fast_fee_debugs):
        if start < a['start']:
            dbg=obj
            break
    if dbg is None:
        a['fee_debug']=None
        out.append(a)
        continue
    program=dbg.get('program')
    programNormalized=dbg.get('programNormalized')
    choice=dbg.get('choice')
    reason=dbg.get('reason') if 'reason' in dbg else None
    matched=dbg.get('matchedRowsSummary')
    feeBasicsKeys=dbg.get('feeBasicsKeys')
    tablePreviews=dbg.get('tablePreviews')

    p=program or ''
    def re_i(pattern):
        return re.search(pattern, p, re.I) is not None
    isDualDegree = re_i(r"dual\s*degree") or re_i(r"\b(utb|dnui)\b") or re_i(r"help\s+university")
    isS2 = re_i(r"\b(s2|pascasarjana|pasca\s*sarjana|magister|master)\b")
    isD3 = re_i(r"\b(d3|diploma)\b") or re_i(r"manajemen\s+informatika")
    isS1Group = re_i(r"sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital")
    isSk = re_i(r"sistem\s+komputer")
    isUtb = isDualDegree and re_i(r"\butb\b")
    isDnui = isDualDegree and re_i(r"\bdnui\b")
    isHelp = isDualDegree and re_i(r"help\s+university")

    tableS1LikeLabel = None
    if (not isDualDegree and not isS2 and not isD3 and (isSk or isS1Group)):
        tableS1LikeLabel = 'sk' if isSk else 's1'
    else:
        tableS1LikeLabel = 'utb' if isUtb else None
    tableS2Label = 's2' if isS2 else None
    tableD3Label = 'd3' if isD3 else None
    tableDualIntlLabel = 'dnui' if isDnui else ('help' if isHelp else None)

    def bucket_has_key(label, key):
        if not tablePreviews or label not in tablePreviews or not tablePreviews[label]:
            return False
        for it in tablePreviews[label]:
            if isinstance(it, dict) and it.get('key')==key:
                return True
        return False

    buckets_with_choice = [k for k in (list(tablePreviews.keys()) if tablePreviews else []) if bucket_has_key(k, choice)]

    chosen=None
    if choice=='pendaftaran':
        if tableDualIntlLabel and bucket_has_key(tableDualIntlLabel, 'pendaftaran'):
            chosen=tableDualIntlLabel
        elif tableS2Label and bucket_has_key('s2','pendaftaran'):
            chosen='s2'
        elif tableD3Label and bucket_has_key('d3','pendaftaran'):
            chosen='d3'
        else:
            if tableS1LikeLabel and bucket_has_key(tableS1LikeLabel,'pendaftaran'):
                chosen=tableS1LikeLabel
            else:
                if bucket_has_key('s1','pendaftaran'):
                    chosen='s1'
                elif bucket_has_key('sk','pendaftaran'):
                    chosen='sk'
    elif choice=='dpp':
        if tableDualIntlLabel and bucket_has_key(tableDualIntlLabel, 'dpp'):
            chosen=tableDualIntlLabel
        else:
            if tableS1LikeLabel and bucket_has_key(tableS1LikeLabel,'dpp'):
                chosen=tableS1LikeLabel
            else:
                if bucket_has_key('s1','dpp'):
                    chosen='s1'
                elif bucket_has_key('sk','dpp'):
                    chosen='sk'
    elif choice=='semester':
        if tableDualIntlLabel and bucket_has_key(tableDualIntlLabel, 'biayaPendidikan'):
            chosen=tableDualIntlLabel
        else:
            if tableS1LikeLabel and bucket_has_key(tableS1LikeLabel,'semester'):
                chosen=tableS1LikeLabel
            else:
                if bucket_has_key('s1','semester'):
                    chosen='s1'
                elif bucket_has_key('sk','semester'):
                    chosen='sk'
                elif tableS2Label and bucket_has_key('s2','semester'):
                    chosen='s2'
                elif tableD3Label and bucket_has_key('d3','semester'):
                    chosen='d3'
    elif choice=='breakdown':
        if tableS1LikeLabel:
            chosen=tableS1LikeLabel
        elif tableS2Label:
            chosen=tableS2Label
        elif tableD3Label:
            chosen=tableD3Label
        elif tableDualIntlLabel:
            chosen=tableDualIntlLabel
    else:
        if tableS1LikeLabel:
            chosen=tableS1LikeLabel
        elif tableS2Label:
            chosen=tableS2Label
        elif tableD3Label:
            chosen=tableD3Label
        elif tableDualIntlLabel:
            chosen=tableDualIntlLabel

    should=None
    for b in buckets_with_choice:
        if b!=chosen:
            should=b
            break

    entry={'chatId':a['chatId'],'routeText':a['routeText'],'program':program,'programNormalized':programNormalized,'choice':choice,'reason':reason,'matchedRowsSummary':matched,'feeBasicsKeys':feeBasicsKeys,'tablePreviews':tablePreviews,'bucketChosenByMapping':chosen,'bucketsWithChoice':buckets_with_choice,'bucketThatShouldContainData':should}
    out.append(entry)

open('tmp/fast_audit_summary.json','w',encoding='utf-8').write(json.dumps(out,ensure_ascii=False,indent=2))
print('WROTE',len(out),'entries to tmp/fast_audit_summary.json')
