import json
import time
import urllib.request
import urllib.error
from pathlib import Path

root = Path(r"c:\Users\TSC-AKA\Videos\MARKETING\BOTAI\system_wa")
log_path = root / "tmp" / "final_wa_outputs.log"
if log_path.exists():
    log_path.unlink()

queries = [
    ('sim-new-a', 'Apa itu TI?'),
    ('sim-new-b', 'Biaya kuliah TI?'),
    ('sim-new-c', 'Saya ingin daftar TI')
]
base_url = "http://127.0.0.1:4001"

for chat_id, text in queries:
    payload = json.dumps({"chatId": chat_id, "text": text}).encode('utf-8')
    req = urllib.request.Request(base_url + "/_simulate", method="POST", data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read().decode('utf-8', errors='replace')
            print(f"SIMULATE {chat_id} {text!r} => {r.status} {body}")
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        print(f"SIMULATE {chat_id} {text!r} => HTTP {e.code} {body}")
    except Exception as e:
        print(f"SIMULATE {chat_id} {text!r} => ERROR {e}")
    time.sleep(2)

print("\nWaiting 5 seconds for server processing...")
time.sleep(5)
print("Reading log file:", log_path)
if log_path.exists():
    content = log_path.read_text(encoding='utf-8', errors='replace')
    print("=== LOG CONTENT START ===")
    print(content)
    print("=== LOG CONTENT END ===")
else:
    print("Log file does not exist after simulation.")
