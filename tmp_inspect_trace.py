import json
from pathlib import Path
p = Path('tmp_trace_ti_2c_output.json')
d = json.loads(p.read_text())
for trace_key in ['[TRACE_COST_MATCH_3_CANDIDATES]', '[TRACE_COST_SELECT_4_TOP_CHUNKS]', '[TRACE_COST_SOURCE_TRUST_RESULTS]']:
    entry = d['traceMap'][trace_key]
    print('===', trace_key)
    print('initial type', type(entry), 'len', len(entry) if hasattr(entry, '__len__') else 'NA')
    while isinstance(entry, list) and len(entry) == 1:
        entry = entry[0]
        print('unwrapped type', type(entry), 'len', len(entry) if hasattr(entry, '__len__') else 'NA')
    if isinstance(entry, dict):
        print('dict keys', list(entry.keys()))
        if trace_key == '[TRACE_COST_MATCH_3_CANDIDATES]':
            print('exactCandidateCount', entry.get('exactCandidateCount'))
            exact = entry.get('exactCandidates', [])
            print('exactCandidates len', len(exact))
            print('exactCandidates ids', [x.get('id') for x in exact[:20]])
            if exact:
                print('first exact candidate sample', exact[0])
        elif trace_key == '[TRACE_COST_SELECT_4_TOP_CHUNKS]':
            print('topChunks len', len(entry.get('topChunks', [])))
            print('topChunks ids', [x.get('id') for x in entry.get('topChunks', [])[:20]])
        elif trace_key == '[TRACE_COST_SOURCE_TRUST_RESULTS]':
            print('trustResults len', len(entry.get('trustResults', [])))
            print('trustResults ids', [x.get('chunkId') for x in entry.get('trustResults', [])[:20]])
    elif isinstance(entry, list):
        print('final list type', [type(x).__name__ for x in entry[:3]])
        if entry and isinstance(entry[0], dict):
            print('first item keys', list(entry[0].keys()))
            print('first item sample', entry[0])

# final result
print('=== final result')
print('success', d['finalResult'].get('success'))
print('source', d['finalResult'].get('source'))
print('trainingId', d['finalResult'].get('trainingId'))
print('filename', d['finalResult'].get('filename'))
print('sourceFile', d['finalResult'].get('sourceFile'))
print('reason', d['finalResult'].get('debug', {}).get('reason'))
print('chunkContext', d['finalResult'].get('chunkContext', '')[:200].replace('\n', ' '))
print('contexts count', len(d['finalResult'].get('contexts', [])))
for c in d['finalResult'].get('contexts', []):
    print(' context', c.get('id'), c.get('filename'), c.get('trainingId'), c.get('chunkType'))
