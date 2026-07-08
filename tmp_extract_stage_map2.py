from pathlib import Path
import re
text_path = Path(r'C:\Users\TSC-AKA\AppData\Roaming\Code\User\workspaceStorage\54b776ef0f0b60c63c2ed919c35cc093\GitHub.copilot-chat\chat-session-resources\207d50e8-1530-46c4-9650-85e44bd2baa0\call_MBpo6yg96rpACE6h2XV2aLBy__vscode-1780617441453\content.txt')
text = text_path.read_text(encoding='utf-8', errors='replace')
entries = []
for m in re.finditer(r'providerRagDebug: \{', text):
    start = m.end()
    end = text.find('}', start)
    block = text[start:end]
    qmatch = re.search(r'"query": "([^"]+)"', block)
    intent = re.search(r'"detectedIntent": "([^"]+)"', block)
    prog = re.search(r'"programHint": "([^"]+)"', block)
    acad = re.search(r'"academicIntent": "([^"]+)"', block)
    next_before = text.find('=== BEFORE DECORATE ===', end)
    snippet = text[next_before:next_before+800] if next_before != -1 else ''
    entries.append((qmatch.group(1) if qmatch else '<missing>', intent.group(1) if intent else '<missing>', prog.group(1) if prog else '<missing>', acad.group(1) if acad else '<missing>', snippet))
Path('query_provider_debug_map.txt').write_text('\n'.join([f'QUERY={q}\nINTENT={intent} PROGRAM={prog} ACADEMIC_INTENT={acad}\nSNIPPET=\n{snippet}\n---' for q,intent,prog,acad,snippet in entries]), encoding='utf-8')
