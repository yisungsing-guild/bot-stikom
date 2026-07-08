p='tmp/jest_fast_fee_debug_output3.txt'
from collections import Counter

with open(p,'rb') as f:
    b=f.read()

patterns = {
    'FAST_AUDIT_utf8': b'[FAST_AUDIT] {',
    'fastAnswerFound_false_utf8': b'fastAnswerFound: false',
}
# build utf16le variants
for k in list(patterns.keys()):
    s = patterns[k]
    # construct utf-16le interleaved variant
    utf16 = b''.join(bytes([c,0]) for c in s)
    patterns[k+'_utf16le'] = utf16

counts = {}
for name,pat in patterns.items():
    counts[name] = b.count(pat)

print('counts:')
for k,v in counts.items():
    print(k, v)

# Also try to find chatId occurrences in utf16le
cids = ['user-program-switch','fee-help-switch','fee-breakdown-chat','fee-breakdown-offer','user1','user-specific','user-fee-offer','user-fee-pendaftaran-noprodi','fee-breakdown-program-override-sk','user-regflow-fee-detail-fast']
for cid in cids:
    utf8 = cid.encode('utf-8')
    utf16 = b''.join(bytes([c,0]) for c in utf8)
    print(cid, 'utf8', b.count(utf8), 'utf16le', b.count(utf16))
