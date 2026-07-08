import json
from pathlib import Path
arr = json.loads(Path('tmp_retrieval_diagnostics.json').read_text(encoding='utf8'))
for o in arr:
    print('QUERY:', o['query'])
    print('  route:', o.get('route'))
    if o.get('exactCostResult'):
        print('  exactCostResult.source:', o['exactCostResult'].get('source'))
    if o.get('feeStruct') is not None:
        print('  feeStruct.found:', True)
        fs = o['feeStruct']
        print('    program:', fs.get('program'), 'wave:', fs.get('wave'), 'sourceFile:', fs.get('sourceFile'))
    if o.get('feeBreakdownResult'):
        print('  feeBreakdownResult.source:', o['feeBreakdownResult'].get('source'))
    print('  selected_chunk:', o.get('selected_chunk_filename'), o.get('selected_chunk_docCategory'))
    print('')
