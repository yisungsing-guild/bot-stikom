import json
from pathlib import Path
arr = json.loads(Path('tmp_retrieval_diagnostics.json').read_text(encoding='utf8'))
print('len=', len(arr))
for o in arr:
    print('QUERY:', o['query'])
    print('  route:', o.get('route'))
    print('  feeStruct:', 'yes' if o.get('feeStruct') else 'no')
    if 'selected_chunk_filename' in o:
        print('  selected_chunk_filename:', o.get('selected_chunk_filename'))
        print('  selected_chunk_docCategory:', o.get('selected_chunk_docCategory'))
    print('  structured_route:', o.get('structured_route'))
    print('  exact_cost_route:', o.get('exact_cost_route'))
    print('  breakdown_route:', o.get('breakdown_route'))
    print()
