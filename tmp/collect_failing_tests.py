import json, re, os

res_path='tmp/jest_provider_results.json'
prov_path='src/routes/provider.js'

with open(res_path,'r',encoding='utf-8') as f:
    data=json.load(f)

suite = data.get('testResults',[0])[0]
assertions = suite.get('assertionResults',[])

prov_text=''
if os.path.exists(prov_path):
    with open(prov_path,'r',encoding='utf-8') as f:
        prov_text=f.read()
        prov_lines=prov_text.splitlines()
else:
    prov_lines=[]

ANSI = re.compile(r'\x1b\[[0-9;]*m')

def strip_ansi(s):
    return ANSI.sub('', s)

fails=[]
for a in assertions:
    if a.get('status')!='failed':
        continue
    title=a.get('title')
    fullName=a.get('fullName')
    # try to get matcher details
    expected=None; actual=None
    fd=a.get('failureDetails',[])
    if fd and isinstance(fd,list) and len(fd)>0:
        mm=fd[0].get('matcherResult') if fd[0] else None
        if mm:
            expected=mm.get('expected')
            actual=mm.get('actual')
    # fallback parse from failureMessages
    if (expected is None or actual is None) and a.get('failureMessages'):
        msg=strip_ansi(a['failureMessages'][0])
        m_exp=re.search(r'Expected:\s*(?:"|\'"\')?([^\n\r"]+)(?:"|\'"\')?', msg)
        m_rec=re.search(r'Received:\s*(?:"|\'"\')?([^\n\r"]+)(?:"|\'"\')?', msg)
        if m_exp and expected is None:
            expected=m_exp.group(1).strip()
        if m_rec and actual is None:
            actual=m_rec.group(1).strip()
    # normalize
    if isinstance(expected, str): expected=expected
    if isinstance(actual, str): actual=actual

    # search provider.js for expected/actual
    match=None; match_line=None; match_snippet=None
    search_terms=[t for t in (actual, expected) if t]
    for term in search_terms:
        if not isinstance(term,str):
            continue
        if len(term)<3:
            continue
        idx=prov_text.find(term)
        if idx!=-1:
            # compute line number and snippet
            upto=prov_text[:idx]
            line_no=upto.count('\n')
            start=max(0,line_no-6)
            end=min(len(prov_lines),line_no+6)
            snippet='\n'.join(prov_lines[start:end])
            match=term
            match_line=line_no+1
            match_snippet=snippet
            break
    fails.append({'title':title,'fullName':fullName,'expected':expected,'actual':actual,'provider_match':bool(match),'match_term':match,'match_line':match_line,'match_snippet':match_snippet})

# write summary
out='tmp/failing_tests_summary.json'
with open(out,'w',encoding='utf-8') as f:
    json.dump(fails,f,ensure_ascii=False,indent=2)

print('WROTE',len(fails),'failed tests to',out)
for it in fails:
    print('\n---')
    print('Test:',it['fullName'])
    print('Title:',it['title'])
    print('Expected:',repr(it['expected']))
    print('Received:',repr(it['actual']))
    print('Provider match found:',it['provider_match'])
    if it['provider_match']:
        print('Match term:',it['match_term'])
        print('Provider snippet around line',it['match_line'])
        print(it['match_snippet'])
