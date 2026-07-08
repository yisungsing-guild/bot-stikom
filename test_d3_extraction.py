import json
import re

with open('src/data/rag_index.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
    
text = json.dumps(data, ensure_ascii=False)

# Test the regex pattern from extractProgramListFromBundledIndex
pattern = r'Manajemen\s*Informatika'
matches = list(re.finditer(pattern, text, re.IGNORECASE))
print(f'Pattern "{pattern}" matches: {len(matches)}')

# Show first 3 matches
for i, m in enumerate(matches[:3]):
    start = max(0, m.start() - 50)
    end = min(len(text), m.end() + 50)
    context = text[start:end]
    print(f'\nMatch {i+1}:')
    print(f'  ...{context}...')
