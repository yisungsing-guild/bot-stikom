from pathlib import Path
import sys

text = Path('src/routes/provider.js').read_text(encoding='utf8')
line = 1
col = 0
state = 'code'
esc = False
stack = []
for i, ch in enumerate(text):
    nextc = text[i + 1] if i + 1 < len(text) else ''
    if ch == '\n':
        line += 1
        col = 0
        if state == 'linecomment':
            state = 'code'
        continue
    col += 1
    if state == 'code':
        if ch == '/' and nextc == '/':
            state = 'linecomment'
            continue
        if ch == '/' and nextc == '*':
            state = 'blockcomment'
            continue
        if ch == '"':
            state = 'double'
            continue
        if ch == "'":
            state = 'single'
            continue
        if ch == chr(96):
            state = 'template'
            continue
        if ch == '{':
            stack.append((line, col))
        elif ch == '}':
            if not stack:
                print('UNMATCHED } at', line, col)
                sys.exit(0)
            stack.pop()
    elif state == 'single':
        if esc:
            esc = False
        elif ch == '\\':
            esc = True
        elif ch == "'":
            state = 'code'
    elif state == 'double':
        if esc:
            esc = False
        elif ch == '\\':
            esc = True
        elif ch == '"':
            state = 'code'
    elif state == 'template':
        if esc:
            esc = False
        elif ch == '\\':
            esc = True
        elif ch == chr(96):
            state = 'code'
    elif state == 'blockcomment':
        if ch == '*' and nextc == '/':
            state = 'code'

print('final state', state, 'stack size', len(stack))
if stack:
    print('last unclosed { at', stack[-1])
