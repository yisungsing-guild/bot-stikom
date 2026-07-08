from pathlib import Path
p=Path('src/routes/provider.js')
lines=p.read_text(encoding='utf8').splitlines()
start=760; end=1120
depth=0
for i,line in enumerate(lines[start-1:end], start):
    opens=line.count('{')
    closes=line.count('}')
    depth += opens - closes
    print(f"{i:5d} depth={depth} opens={opens} closes={closes} | {line.strip()}")
