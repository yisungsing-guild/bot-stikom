import re, json

p='tmp/jest_fast_fee_debug_output3.txt'
with open(p,'r',encoding='utf-16le',errors='ignore') as f:
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
    out.append(a)

open('tmp/fast_audit_summary_after.json','w',encoding='utf-8').write(json.dumps(out,ensure_ascii=False,indent=2))
print('WROTE',len(out),'entries to tmp/fast_audit_summary_after.json')
