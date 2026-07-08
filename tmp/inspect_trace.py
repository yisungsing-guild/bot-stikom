from pathlib import Path
p = Path(r'tmp/rag_trace_query.txt')
data = p.read_bytes()
text = data.decode('utf-16')
for needle in ['[TRACE_RAG_DECISION]','[TRACE_RAG_DECISION_DEBUG]','RESULT_JSON_START','RESULT_JSON_END']:
    print('---', needle, '---')
    idx = text.find(needle)
    print('index', idx)
    if idx != -1:
        print(text[idx:idx+12000])
        print()
