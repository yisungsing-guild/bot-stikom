import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

root = Path(r"c:\Users\TSC-AKA\Videos\MARKETING\BOTAI\system_wa")

print("Workspace root:", root)
if not root.exists():
    raise FileNotFoundError(f"Workspace root not found: {root}")

print("Python:", sys.version.replace('\n', ''))

try:
    node_version = subprocess.run(["node", "--version"], cwd=root, capture_output=True, text=True, check=True)
    print("Node version:", node_version.stdout.strip())
except Exception as exc:
    print("Failed to run node:", exc)
    sys.exit(1)

server_cmd = ["node", "--max-old-space-size=2048", "src/index.js"]
env = os.environ.copy()
env["NODE_ENV"] = "development"
env["PORT"] = "4001"
print("Starting server:", " ".join(server_cmd))
proc = subprocess.Popen(server_cmd, cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

base_url = "http://127.0.0.1:4001"

print("Waiting for server startup...")
started = False
for i in range(30):
    time.sleep(1)
    try:
        req = urllib.request.Request(base_url + "/_simulate", method="POST", data=b"{}", headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as r:
            print("Server responded to /_simulate with status", r.status)
            started = True
            break
    except Exception as exc:
        sys.stdout.write('.')
        sys.stdout.flush()
        last_exc = exc

print()
if not started:
    print("Server did not start in time.")
    proc.terminate()
    outs, errs = proc.communicate(timeout=5)
    print("stdout:\n", outs)
    print("stderr:\n", errs)
    raise RuntimeError(f"Server failed to start: {last_exc}")

queries = [
    'Apa itu TI?',
    'Apa yang dipelajari di TI?',
    'Prospek kerja TI?',
    'Biaya kuliah TI?',
    'Akreditasi TI?',
    'Saya ingin daftar TI'
]

print("\nRunning simulations...")
for text in queries:
    payload = f'{{"chatId":"test-chat","text":{text!r}}}'.encode('utf-8')
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

log_path = root / "tmp" / "final_wa_outputs.log"
print("\nReading log file:", log_path)
if log_path.exists():
    content = log_path.read_text(encoding='utf-8', errors='replace')
    print("=== LOG CONTENT START ===")
    print(content)
    print("=== LOG CONTENT END ===")
else:
    print("Log file does not exist.")

print("\nStopping server...")
proc.terminate()
try:
    outs, errs = proc.communicate(timeout=10)
except subprocess.TimeoutExpired:
    proc.kill()
    outs, errs = proc.communicate(timeout=5)

print("--- server stdout ---")
print(outs)
print("--- server stderr ---")
print(errs)
