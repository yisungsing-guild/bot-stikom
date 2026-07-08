import json
from pathlib import Path
path = Path('src/data/rag_index.json')
print('exists', path.exists())
with path.open('r', encoding='utf-8') as f:
    data = json.load(f)
count_mi = 0
count_informasi = 0
count_mi_prog = 0
for item in data:
    s = json.dumps(item, ensure_ascii=False).lower()
    if 'manajemen informatika' in s:
        count_mi += 1
    if 'manajemen informasi' in s:
        count_informasi += 1
    if str(item.get('program')).upper() == 'MI':
        count_mi_prog += 1
print('manajemen informatika count', count_mi)
print('manajemen informasi count', count_informasi)
print('program MI count', count_mi_prog)
