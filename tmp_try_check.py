from pathlib import Path
p=Path('src/routes/provider.js')
lines=p.read_text(encoding='utf8').splitlines()
start=1; end=len(lines)
stack=[]
try_stack=[]
for i,line in enumerate(lines[start-1:end], start):
    s=line
    # track braces
    for ch in s:
        if ch=='{':
            stack.append((i,line))
        elif ch=='}':
            if stack:
                stack.pop()
            else:
                print('UNMATCHED_CLOSE at', i, 'content=', line.strip())
    if 'try {' in s or s.strip().startswith('try {'):
        depth=len(stack)
        try_stack.append((i, depth))
    if 'catch (' in s:
        depth=len(stack)
        if not try_stack:
            print('ORPHAN_CATCH at', i, 'content=', line.strip(), 'depth=', depth)
        else:
            tline,tdepth=try_stack.pop()
            if depth!=tdepth:
                print('MISMATCH try at',tline,'depth',tdepth,'catch at',i,'depth',depth)

print('Remaining try_stack count', len(try_stack))
if try_stack:
    print('Top remaining try', try_stack[-1])
print('Remaining brace stack length', len(stack))
if stack:
    print('Top brace at line', stack[-1][0])
