import io
import json
import os
from pathlib import Path
import socket
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import model_server
import qwen_scoring


class ScoringTests(unittest.TestCase):
    def test_scoring_matches_research_first_token_and_template(self):
        mx = SimpleNamespace(array=lambda x: x, argmax=Mock(return_value=4))
        step = Mock(return_value=iter([(4, {7: -0.5, 9: -3.0})]))
        tokenizer = Mock(bos_token='<bos>')
        tokenizer.apply_chat_template.return_value = '<bos>chat'
        tokenizer.encode.side_effect = lambda text, **kw: {'YES': [7, 77], 'NO': [9], '<bos>chat': [1, 2]}[text]
        messages = [{'role': 'user', 'content': 'One word?'}]
        model_server._prefix = {'ids': None, 'state': None, 'seen': None}
        with patch.dict('sys.modules', {'mlx': SimpleNamespace(core=mx), 'mlx.core': mx,
                                      'mlx_lm.generate': SimpleNamespace(generate_step=step),
                                      'mlx_lm.models.cache': SimpleNamespace(make_prompt_cache=lambda model: [])}):
            reply = model_server.score_first_tokens('model', tokenizer,
                {'messages': messages, 'candidates': ['YES', 'NO']})
        self.assertEqual(reply, {'logprobs': {'YES': -0.5, 'NO': -3.0}})
        tokenizer.apply_chat_template.assert_called_once_with(messages, tokenize=False,
            add_generation_prompt=True, enable_thinking=False)
        tokenizer.encode.assert_any_call('<bos>chat', add_special_tokens=False)
        self.assertEqual(step.call_args.args, ([1, 2], 'model'))
        self.assertEqual(step.call_args.kwargs['max_tokens'], 1)
        self.assertEqual(step.call_args.kwargs['prefill_step_size'], 128)

    def test_a_shared_question_opening_is_run_once_and_reused(self):
        class Arr(list):
            def __getitem__(self, index):
                return self if index is None else list.__getitem__(self, index)

        class Layer:
            def __init__(self):
                self.state = []

        mx = SimpleNamespace(array=lambda x: Arr(x) if isinstance(x, list) else x, argmax=Mock(), eval=lambda *a: None)
        fed = []
        model = Mock(side_effect=lambda x, cache: [fed.append(len(x)), [layer.state.append(len(x)) for layer in cache]])
        step = Mock(side_effect=lambda ids, *a, **k: iter([(0, {7: -1.0, 9: -2.0})]))
        prompts = {f'p{k}': list(range(130)) + [1000 + k, 2000 + k] for k in range(3)}
        tokenizer = Mock(bos_token=None)
        tokenizer.apply_chat_template.side_effect = lambda messages, **kw: messages[0]['content']
        tokenizer.encode.side_effect = lambda text, **kw: {'YES': [7], 'NO': [9]}.get(text) or prompts[text]
        model_server._prefix = {'ids': None, 'state': None, 'seen': None}
        with patch.dict('sys.modules', {'mlx': SimpleNamespace(core=mx), 'mlx.core': mx,
                                      'mlx_lm.generate': SimpleNamespace(generate_step=step),
                                      'mlx_lm.models.cache': SimpleNamespace(make_prompt_cache=lambda m: [Layer(), Layer()])}):
            for k in range(3):
                reply = model_server.score_first_tokens(model, tokenizer, {'messages': [{'role': 'user', 'content': f'p{k}'}], 'candidates': ['YES', 'NO']})
                self.assertEqual(reply, {'logprobs': {'YES': -1.0, 'NO': -2.0}})
        self.assertEqual([len(call.args[0]) for call in step.call_args_list], [132, 2, 2])
        self.assertEqual(fed, [128, 2])  # the shared 130 tokens ran once, in prefill steps of 128
        self.assertEqual(step.call_args_list[2].args[0], [1002, 2002])

    def exchange(self, reply, candidates=('YES', 'NO')):
        with tempfile.TemporaryDirectory() as folder:
            address = str(Path(folder) / 'q.sock')
            with socket.socket(socket.AF_UNIX) as server:
                server.bind(address)
                server.listen(1)
                received = []

                def worker():
                    with server.accept()[0] as connection:
                        received.append(json.loads(connection.makefile('r').readline()))
                        connection.sendall(reply)

                thread = threading.Thread(target=worker)
                thread.start()
                try:
                    with patch.dict(os.environ, {'MEMORIA_QWEN_SOCKET': address}):
                        result = qwen_scoring.first_token_logprobs([{'role': 'user', 'content': '?'}], candidates, timeout=1)
                finally:
                    thread.join(2)
                return result, received

    def test_socket_protocol_progress_and_candidate_variants(self):
        scores, received = self.exchange(b'{"progress":"ready"}\n{"logprobs":{" YES":-0.25,"NO":-2}}\n', (' YES', 'NO'))
        self.assertEqual(scores, {' YES': -0.25, 'NO': -2})
        self.assertEqual(received[0], {'type': 'score', 'messages': [{'role': 'user', 'content': '?'}], 'candidates': [' YES', 'NO']})

    def test_invalid_errors_eof_and_nonfinite_fail_closed(self):
        for reply in (b'', b'{"error":"old worker"}\n', b'{"text":"YES"}\n',
                      b'{"logprobs":{"YES":true,"NO":0}}\n',
                      b'{"logprobs":{"YES":NaN,"NO":0}}\n'):
            with self.subTest(reply=reply), self.assertRaises(ValueError):
                self.exchange(reply)

    def test_timeout_and_score_difference(self):
        with self.assertRaises(TimeoutError):
            qwen_scoring.score([], timeout=0)
        with patch('qwen_scoring.first_token_logprobs', return_value={'YES': -1.5, 'NO': -3}):
            self.assertEqual(qwen_scoring.score([]), 1.5)

    def test_discovery_matches_engine_and_does_not_spawn_when_absent(self):
        from engine import digest
        import sys
        with patch.dict(os.environ, {}, clear=True):
            script = Path(model_server.__file__)
            expected = str(Path(tempfile.gettempdir()) / f'memoria-{os.getuid()}-{digest(script.read_text() + sys.executable)[:12]}.sock')
            self.assertEqual(qwen_scoring.socket_address(), expected)
        with patch.dict(os.environ, {'MEMORIA_QWEN_SOCKET': '/nonexistent/memoria-test.sock'}):
            with self.assertRaises(OSError):
                qwen_scoring.score([])

    def test_worker_generation_protocol_unchanged_and_score_dispatch(self):
        class Connection:
            def __init__(self, request):
                self.request, self.sent = request, []
            def __enter__(self): return self
            def __exit__(self, *exc): pass
            def settimeout(self, value): pass
            def makefile(self, mode): return io.StringIO(json.dumps(self.request) + '\n')
            def sendall(self, value): self.sent.append(json.loads(value))

        generation = Connection({'prompt': 'JSON please'})
        scoring = Connection({'type': 'score', 'messages': [], 'candidates': ['YES', 'NO']})
        listener = Mock()
        listener.accept.side_effect = [(generation, None), (scoring, None), socket.timeout()]
        tokenizer = Mock()
        tokenizer.apply_chat_template.return_value = 'rendered'
        load = Mock(return_value=('model', tokenizer))
        stream = Mock(return_value=iter([SimpleNamespace(text='{"ok":'), SimpleNamespace(text='true}')]))
        modules = {'huggingface_hub': SimpleNamespace(snapshot_download=lambda *a, **k: 'path'),
                   'mlx_lm': SimpleNamespace(load=load, stream_generate=stream),
                   'mlx_lm.sample_utils': SimpleNamespace(make_sampler=lambda **kw: 'greedy')}
        with tempfile.TemporaryDirectory() as folder, patch.dict('sys.modules', modules), \
                patch('model_server.socket.socket', return_value=listener), \
                patch('model_server.select.select', return_value=([], [], [])), \
                patch('model_server.score_first_tokens', return_value={'logprobs': {'YES': -1, 'NO': -2}}) as score, \
                patch.object(Path, 'chmod'):
            model_server.serve(str(Path(folder) / 'fake.sock'))
        self.assertEqual(generation.sent[-1], {'text': '{"ok":true}'})
        self.assertEqual(scoring.sent, [{'logprobs': {'YES': -1, 'NO': -2}}])
        load.assert_called_once()
        score.assert_called_once_with('model', tokenizer, scoring.request)
        self.assertEqual(stream.call_args.kwargs['max_tokens'], 1800)

    def test_worker_honours_a_smaller_generation_budget_only(self):
        class Connection:
            def __init__(self, request):
                self.request, self.sent = request, []
            def __enter__(self): return self
            def __exit__(self, *exc): pass
            def settimeout(self, value): pass
            def makefile(self, mode): return io.StringIO(json.dumps(self.request) + '\n')
            def sendall(self, value): self.sent.append(json.loads(value))

        requests = [Connection({'prompt': 'short', 'maxTokens': 320}), Connection({'prompt': 'huge', 'maxTokens': 99999}),
                    Connection({'prompt': 'odd', 'maxTokens': '320'}), Connection({'prompt': 'zero', 'maxTokens': 0})]
        listener = Mock()
        listener.accept.side_effect = [(request, None) for request in requests] + [socket.timeout()]
        tokenizer = Mock()
        tokenizer.apply_chat_template.return_value = 'rendered'
        stream = Mock(side_effect=lambda *a, **k: iter([SimpleNamespace(text='{}')]))
        modules = {'huggingface_hub': SimpleNamespace(snapshot_download=lambda *a, **k: 'path'),
                   'mlx_lm': SimpleNamespace(load=Mock(return_value=('model', tokenizer)), stream_generate=stream),
                   'mlx_lm.sample_utils': SimpleNamespace(make_sampler=lambda **kw: 'greedy')}
        with tempfile.TemporaryDirectory() as folder, patch.dict('sys.modules', modules), \
                patch('model_server.socket.socket', return_value=listener), \
                patch('model_server.select.select', return_value=([], [], [])), \
                patch.object(Path, 'chmod'):
            model_server.serve(str(Path(folder) / 'fake.sock'))
        self.assertEqual([call.kwargs['max_tokens'] for call in stream.call_args_list], [320, 1800, 1800, 1800])
        self.assertTrue(all(request.sent[-1] == {'text': '{}'} for request in requests))


if __name__ == '__main__':
    unittest.main()
