from pathlib import Path
import re
text_path = Path(r'C:\Users\TSC-AKA\AppData\Roaming\Code\User\workspaceStorage\54b776ef0f0b60c63c2ed919c35cc093\GitHub.copilot-chat\chat-session-resources\207d50e8-1530-46c4-9650-85e44bd2baa0\call_MBpo6yg96rpACE6h2XV2aLBy__vscode-1780617441453\content.txt')
text = text_path.read_text(encoding='utf-8', errors='replace')
queries = [(m.start(), m.group(1)) for m in re.finditer(r'Program retrieval audit\s*\n\s*question: "([^"]+)"', text)]
if not queries:
    queries = [(m.start(), m.group(1)) for m in re.finditer(r'question: "([^"]+)"', text)]
markers = [m.start() for m in re.finditer(re.escape('=== BEFORE DECORATE ==='), text)]
out = []
for i,(qpos,qtext) in enumerate(queries):
    next_qpos = queries[i+1][0] if i+1 < len(queries) else len(text)
    these = [pos for pos in markers if qpos < pos < next_qpos]
    out.append(f'QUERY:{qtext} MARKER_COUNT:{len(these)}')
    if these:
        pos=these[0]
        out.append('SNIPPET:')
        out.append(text[pos:pos+400])
        out.append('---')
Path('query_marker_counts.txt').write_text('\n'.join(out), encoding='utf-8')
