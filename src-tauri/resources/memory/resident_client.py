"""Request adapters connect to an app-owned worker, never launch extra models."""
import json
import socket
import sys
import threading
import time

def relay(address, operation):
    connection = socket.socket(socket.AF_UNIX)
    connection.settimeout(120)
    for attempt in range(600):
        try:
            connection.connect(address); break
        except (FileNotFoundError, ConnectionRefusedError): time.sleep(.1)
    else: raise ValueError('AI model is still preparing or unavailable. Check AI readiness.')
    # Live sessions may be silent for minutes, and a long recording reports once per
    # five-minute part. Liveness belongs to the app's process manager, not a timeout
    # waiting for transcript text.
    if operation in ('live', 'transcribe'): connection.settimeout(None)
    connection.sendall((json.dumps({'operation': operation}) + '\n').encode())
    def send():
        try:
            for line in sys.stdin:
                connection.sendall(line.encode())
            connection.shutdown(socket.SHUT_WR)
        except OSError: pass
    threading.Thread(target=send, daemon=True).start()
    try:
        for line in connection.makefile('r'):
            print(line, end='', flush=True)
    finally: connection.close()
