import tempfile
import unittest
from pathlib import Path

from worker_lifetime import exit_with_parent


class WorkerLifetimeTests(unittest.TestCase):
    def test_worker_exits_and_removes_its_socket_when_the_app_dies(self):
        # Observed natively: after the app was killed, three resident workers kept their models loaded.
        with tempfile.TemporaryDirectory() as folder:
            address = Path(folder) / 'mm-1-test-qwen.sock'
            address.write_text('')
            parents = iter([4321, 4321, 4321, 1])
            exits = []
            thread = exit_with_parent(str(address), interval=0, getppid=lambda: next(parents), sleep=lambda _: None, exit=exits.append)
            thread.join(timeout=2)
            self.assertEqual(exits, [0])
            self.assertFalse(address.exists())

    def test_worker_keeps_running_while_the_app_lives(self):
        calls = []
        def sleep(_):
            calls.append(1)
            if len(calls) > 3: raise SystemExit  # stop the watcher thread after a few checks
        exits = []
        thread = exit_with_parent('/nonexistent.sock', interval=0, getppid=lambda: 4321, sleep=sleep, exit=exits.append)
        thread.join(timeout=2)
        self.assertEqual(exits, [])


if __name__ == '__main__':
    unittest.main()
