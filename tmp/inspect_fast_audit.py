import re

p='tmp/jest_fast_fee_debug_output3.txt'
with open(p,'r',encoding='utf-8',errors='ignore') as f:
    s=f.read()

# helper
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

items=[]
for m in re.finditer(r"\[FAST_AUDIT\]\s*\{", s):
    start=m.start()
    brace=s.find('{', start)
    raw=extract_block(s, brace)
    if not raw: continue
    block=raw
    def find_str(key):
        mm=re.search(key+":\s*'([^']*)'", block)
        return mm.group(1) if mm else None
    def find_bool(key):
        mm=re.search(key+":\s*(true|false)", block)
        return (mm.group(1)=='true') if mm else None
    chatId=find_str('chatId')
    allowBundledIndex=find_bool('allowBundledIndex')
    allowFast=find_bool('allowFast')
    hasBundleData=find_bool('hasBundleData')
    fastAnswerFound=find_bool('fastAnswerFound')
    items.append({'chatId':chatId,'allowBundledIndex':allowBundledIndex,'allowFast':allowFast,'hasBundleData':hasBundleData,'fastAnswerFound':fastAnswerFound})

print('TOTAL_FAST_AUDIT_BLOCKS', len(items))
matched=[it for it in items if it['allowBundledIndex'] and it['allowFast'] and it['hasBundleData'] and (it['fastAnswerFound'] is False)]
print('MATCHING_FILTER', len(matched))
for it in matched:
    print(it)

# also print any blocks where fastAnswerFound is False (for debugging)
fa_false=[it for it in items if it['fastAnswerFound'] is False]
print('FAST_ANSWER_FALSE_TOTAL', len(fa_false))
for it in fa_false:
    print(it)
