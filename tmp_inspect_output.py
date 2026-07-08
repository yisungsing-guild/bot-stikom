from pathlib import Path
p = Path('tmp_run_8_queries_output.json')
for enc in ['utf-16', 'utf-8', 'utf-16-le', 'utf-16-be']:
    try:
        txt = p.read_text(encoding=enc)
        print('ENC', enc, 'LEN', len(txt), 'HEAD', repr(txt[:200]))
    except Exception as e:
        print('ENC', enc, 'ERR', type(e).__name__, e)
