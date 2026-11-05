"""First-token scoring via the existing Qwen socket; never starts a worker."""
import hashlib
import json
import math
import os
from pathlib import Path
import socket
import sys
import tempfile
import time


def socket_address():
    # Same discovery/version identity as engine.local_generator, without importing
    # engine or triggering its worker-start fallback. A verifier normally warmed it.
    script = Path(__file__).with_name('model_server.py')
    identity = hashlib.sha256((script.read_text() + sys.executable).encode()).hexdigest()[:12]
    return os.environ.get('MEMORIA_QWEN_SOCKET') or str(
        Path(tempfile.gettempdir()) / f'memoria-{os.getuid()}-{identity}.sock')


def first_token_logprobs(messages, candidates=('YES', 'NO'), timeout=110):
    if timeout <= 0:
        raise TimeoutError('Live verification time budget exceeded.')
    deadline = time.monotonic() + timeout
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(timeout)
        connection.connect(socket_address())
        connection.sendall((json.dumps({'type': 'score', 'messages': messages,
                                       'candidates': list(candidates)}) + '\n').encode())
        # Bound total elapsed time, not just idle time between progress messages.
        buffer = b''
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('Live verification time budget exceeded.')
            connection.settimeout(remaining)
            part = connection.recv(4096)
            if not part:
                raise ValueError('Local scoring connection closed before completing')
            buffer += part
            if len(buffer) > 65536:
                raise ValueError('Local scoring response exceeded the limit')
            while b'\n' in buffer:
                line, buffer = buffer.split(b'\n', 1)
                reply = json.loads(line)
                if 'progress' in reply:
                    continue
                scores = reply.get('logprobs')
                if not isinstance(scores, dict) or set(scores) != set(candidates):
                    raise ValueError(reply.get('error', 'Invalid local scoring response'))
                if any(type(s) not in (int, float) or not math.isfinite(s) for s in scores.values()):
                    raise ValueError('Invalid local first-token logprob')
                return scores


def score(messages, timeout=110):
    scores = first_token_logprobs(messages, timeout=timeout)
    return scores['YES'] - scores['NO']


def meeting_reply(transcript, question, timeout=60, max_tokens=200):
    """Answer a question from the live transcript the worker keeps cached; an empty question only warms the cache."""
    deadline = time.monotonic() + timeout
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(timeout)
        connection.connect(socket_address())
        connection.sendall((json.dumps({'type': 'meeting', 'transcript': transcript, 'question': question,
                                       'maxTokens': max_tokens}) + '\n').encode())
        buffer = b''
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('Live answer time budget exceeded.')
            connection.settimeout(remaining)
            part = connection.recv(65536)
            if not part:
                raise ValueError('Local model connection closed before completing')
            buffer += part
            while b'\n' in buffer:
                line, buffer = buffer.split(b'\n', 1)
                reply = json.loads(line)
                if 'progress' in reply:
                    continue
                if not isinstance(reply.get('text'), str):
                    raise ValueError(reply.get('error', 'Invalid local answer'))
                return reply['text']
