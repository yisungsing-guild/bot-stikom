from pathlib import Path
p = Path('temp-test-output.txt')
print('size', p.stat().st_size)
raw = p.read_bytes()
text = raw.decode('utf-16')
print('decoded length', len(text))
debug_lines = [line for line in text.splitlines() if '[DEBUG]' in line]
print('DEBUG lines count', len(debug_lines))
for line in debug_lines[:120]:
    print(line)
for phrase in ['SESSION AFTER 1', 'SESSION AFTER 2', 'SESSION AFTER 3', 'RESPONSE 1 BODY']:
    idx = text.find(phrase)
    print('FIND', phrase, idx)
    if idx >= 0:
        start = text.rfind('\n', 0, idx) + 1
        end = text.find('\n', idx)
        print(text[start:end])
        print('--- next 10 lines ---')
        remaining = text[end+1:][:1000].splitlines()
        for l in remaining[:12]:
            print(l)
        print('-------------------')
print('--- last 40 lines ---')
for line in text.splitlines()[-40:]:
    print(line)
