import re, json

files = [
    ('tmp/jest_fast_fee_debug_output2.txt','before','tmp/fast_audit_summary_before.json'),
    ('tmp/jest_fast_fee_debug_output3.txt','after','tmp/fast_audit_summary_after.json'),
]

def parse_file(path):
    try:
        with open(path,'r',encoding='utf-16le',errors='ignore') as f:
            s=f.read()
    except Exception as e:
        return []

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

    blocks=[]
    for m in re.finditer(r"\[FAST_AUDIT\]\s*\{", s):
        start=m.start()
        brace=s.find('{', start)
        raw=extract_block(s, brace)
        if not raw:
            continue
        block=raw
        def find_str(key):
            mm=re.search(key+":\s*'([^']*)'", block)
            return mm.group(1) if mm else None
        def find_bool(key):
            mm=re.search(key+":\s*(true|false)", block)
            return (mm.group(1)=='true') if mm else None
        chatId=find_str('chatId') or '<unknown>'
        allowBundledIndex=find_bool('allowBundledIndex')
        allowFast=find_bool('allowFast')
        hasBundleData=find_bool('hasBundleData')
        fastAnswerFound=find_bool('fastAnswerFound')
        if allowBundledIndex and allowFast and hasBundleData and fastAnswerFound is False:
            blocks.append({'chatId':chatId,'raw':block})
    return blocks

data = {}
for path,label,outfile in files:
    blocks = parse_file(path)
    data[label] = blocks
    open(outfile,'w',encoding='utf-8').write(json.dumps(blocks,ensure_ascii=False,indent=2))
    print('WROTE',len(blocks),'entries to',outfile)

all_chatids = set([b['chatId'] for b in data['before']] + [b['chatId'] for b in data['after']])

rows=[]
for cid in sorted(all_chatids):
    before=sum(1 for b in data['before'] if b['chatId']==cid)
    after=sum(1 for b in data['after'] if b['chatId']==cid)
    if before>0 and after==0:
        result='fixed'
    elif before==0 and after>0:
        result='regressed'
    elif before==0 and after==0:
        result='no-issue'
    else:
        result='still-failing'
    rows.append((cid,before,after,result))

print('\nchatId | before | after | result')
for cid,before,after,res in rows:
    print(f"{cid} | {before} | {after} | {res}")

fixed = [r for r in rows if r[3]=='fixed']
still = [r for r in rows if r[3]=='still-failing']
regressed = [r for r in rows if r[3]=='regressed']
print('\nSummary: fixed=',len(fixed),'still_failing=',len(still),'regressed=',len(regressed))
