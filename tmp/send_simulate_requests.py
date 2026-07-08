import json
import os
import urllib.request
import urllib.error
from pathlib import Path
import time

root = Path(r"c:\Users\TSC-AKA\Videos\MARKETING\BOTAI\system_wa")
log_path = root / "tmp" / "final_wa_outputs.log"
if log_path.exists():
    print("Removing existing log file:", log_path)
    log_path.unlink()
else:
    print("No existing log file to remove.")

queries = [
    'Apa itu TI?',
    'Apa yang dipelajari di TI?',
    'Prospek kerja TI?',
    'Biaya kuliah TI?',
    'Akreditasi TI?',
    'Saya ingin daftar TI'
]
base_url = "http://127.0.0.1:4001"

for text in queries:
    payload = json.dumps({"chatId": "test-chat", "text": text}).encode('utf-8')
    req = urllib.request.Request(base_url + "/_simulate", method="POST", data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read().decode('utf-8', errors='replace')
            print(f"SIMULATE {text!r} => {r.status} {body}")
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        print(f"SIMULATE {text!r} => HTTP {e.code} {body}")
    except Exception as e:
        print(f"SIMULATE {text!r} => ERROR {e}")
    time.sleep(1.5)

print("Waiting 10 seconds for server processing...")
time.sleep(10)
print("\nReading log file:", log_path)
if log_path.exists():
    content = log_path.read_text(encoding='utf-8', errors='replace')
    print("=== LOG CONTENT START ===")
    print(content)
    print("=== LOG CONTENT END ===")
else:
    print("Log file does not exist after simulation.")
