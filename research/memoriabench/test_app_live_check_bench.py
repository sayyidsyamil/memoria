"""App bridge tests: temporary ledgers and fake model calls only."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import app_live_check_bench as A
from memoria_engine.service import Service
from temporal_support import temporal_home

MEMORY = '''- [Xb:02:01] Supplier choice is Acme. (replaces Globex)
- [Xc:03:02] Supplier deadline is March.
'''


class AppBenchTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {'MEMORIA_GUARD': 'on'})
        environment.start()
        self.addCleanup(environment.stop)

    def test_workspace_approved_current_quotes_and_superseded_history(self):
        with tempfile.TemporaryDirectory() as folder:
            citations = A.build_workspace(Path(folder), MEMORY)
            service = Service(str(temporal_home(folder)), extractor='none')
            try:
                facts = service.facts_current()
                self.assertEqual(len(facts), 2)
                self.assertEqual(len(citations), 2)
                self.assertEqual(service.proposals_list(), [])
                first = facts[0]
                self.assertEqual(first['value'], 'Supplier choice is Acme.')
                self.assertEqual(first['evidence'][0]['quote'], 'Supplier choice is Acme. (replaces Globex)')
                self.assertEqual(first['evidence'][0]['audio_start'], 121)
                history = service.facts_history(first['object_id'], first['attribute'])
                self.assertEqual({h['value'] for h in history}, {'Globex', 'Supplier choice is Acme.'})
                old = next(h for h in history if h['value'] == 'Globex')
                self.assertEqual(first['supersedes'], old['fact_id'])
                self.assertNotIn(old['fact_id'], citations)
            finally:
                service.pipe.ledger.close()

    def test_real_supersession_uses_old_quote_and_citation(self):
        provenance = [{'basis': 'real-supersession', 'decision': 'Xb:02:01', 'replaces': 'Globex',
                       'old_text': 'Supplier choice is Globex.', 'old_decision': 'Xa:01:00'}]
        with tempfile.TemporaryDirectory() as folder:
            A.build_workspace(Path(folder), MEMORY, provenance)
            service = Service(str(temporal_home(folder)), extractor='none')
            try:
                first = service.facts_current()[0]
                history = service.facts_history(first['object_id'], first['attribute'])
                old = next(h for h in history if h['value'] == 'Supplier choice is Globex.')
                self.assertEqual(old['evidence'][0]['meeting'], 'Xa:01:00')
                self.assertEqual(old['evidence'][0]['quote'], 'Supplier choice is Globex.')
            finally:
                service.pipe.ledger.close()

    def test_fake_run_scores_app_output_without_gold_leakage(self):
        probes = [{'id': 'X-O-01', 'series_id': 'X', 'statement': 'Supplier choice is Globex.',
                   'gold_label': 'OUTDATED', 'gold_citation': '[Xb:02:01]', 'expected_alert': True},
                  {'id': 'X-I-01', 'series_id': 'X', 'statement': 'Pancakes taste delicious.',
                   'gold_label': 'IRRELEVANT', 'gold_citation': '', 'expected_alert': False}]
        def verify(statement, facts):
            self.assertNotIn('gold_label', str(facts))
            return {'contradiction': True, 'reason': 'Conflicts with the current choice.', 'factId': facts[0]['factId']}
        verifier, scorer = Mock(side_effect=verify), Mock(return_value=2)
        with patch.dict(os.environ, {'MEMORIA_GUARD': 'on'}):
            rows = A.run(probes, {'X': MEMORY}, verifier=verifier, scorer=scorer)
        self.assertEqual([r['alert'] for r in rows], [True, False])
        self.assertEqual(rows[0]['citation'], '[Xb:02:01]')
        self.assertEqual(rows[0]['pred'], 'CONTRADICTS')  # binary placeholder, NOT OUTDATED classification
        verifier.assert_called_once()
        scorer.assert_called_once()
        metrics = A.summarise(rows)
        self.assertEqual((metrics['tp'], metrics['tn'], metrics['fp'], metrics['fn']), (1, 1, 0, 0))
        self.assertNotIn('macro_f1', metrics)
        self.assertNotIn('accuracy', metrics)

    def test_guard_dropped_error_and_no_model_socket_requirement(self):
        probe = {'id': 'X-C-01', 'series_id': 'X', 'statement': 'Supplier choice is Beta.',
                 'gold_label': 'CONTRADICTS', 'gold_citation': '[Xb:02:01]', 'expected_alert': True}
        verifier = lambda s, f: {'contradiction': True, 'reason': 'Conflict.', 'factId': f[0]['factId']}
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, 'MEMORIA_QWEN_SOCKET'):
                A.run([probe], {'X': MEMORY})
            rows = A.run([probe], {'X': MEMORY}, verifier=verifier, scorer=lambda m: -1)
        self.assertFalse(rows[0]['alert'])
        self.assertTrue(any('Guard dropped' in w for w in rows[0]['warnings']))
        rows = A.run([probe], {'X': MEMORY}, verifier=verifier, scorer=Mock(side_effect=TimeoutError('offline')))
        self.assertEqual(rows[0]['status'], 'uncertain')
        self.assertEqual(A.summarise(rows)['uncertain'], 1)

    def test_frozen_inputs_and_dev_split_read_without_model_libraries(self):
        for split, expected in (('test', 336), ('dev', 60)):
            rows, provenance, memories = A.load_inputs(split)
            self.assertEqual(len(rows), expected)
            self.assertTrue(all(r['series_id'] in memories for r in rows))
            self.assertTrue(provenance)
        import sys
        self.assertNotIn('mlx_lm', sys.modules)
        self.assertNotIn('memoria', sys.modules)

    def test_all_frozen_probes_run_on_approved_fixtures_with_fakes(self):
        # Includes repeated summary text at distinct citations and all real and
        # synthetic replacement histories. No performance claim from fake scores.
        def verify(statement, facts):
            return {'contradiction': True, 'reason': 'Fake protocol exercise.', 'factId': facts[0]['factId']}
        for split, expected in (('test', 336), ('dev', 60)):
            probes, provenance, memories = A.load_inputs(split)
            rows = A.run(probes, memories, provenance, verifier=verify, scorer=lambda messages: -1)
            self.assertEqual(len(rows), expected)
            self.assertTrue(all(row['error'] is None for row in rows))

    def test_cli_limit_dev_wires_and_new_output_only(self):
        fake_probe = {'id': 'a', 'series_id': 'X'}
        fake_row = {'id': 'a', 'status': 'quiet'}
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'MEMORIA_QWEN_SOCKET': 'app.sock'}), \
                patch.object(A, 'load_inputs', return_value=([fake_probe] * 2, [], {'X': MEMORY})) as load, \
                patch.object(A, 'run', return_value=[fake_row]) as run, \
                patch.object(A, 'summarise', return_value={'n': 1}), patch('builtins.print'):
            output = Path(folder) / 'new.jsonl'
            self.assertEqual(A.main(['--dev', '--limit', '1', '--output', str(output)]), 0)
            load.assert_called_once_with('dev')
            self.assertEqual(len(run.call_args.args[0]), 1)
            self.assertEqual(json.loads(output.read_text()), fake_row)
            with self.assertRaises(SystemExit):
                A.main(['--output', str(output)])

    def test_binary_paired_comparison_and_mismatch_refused(self):
        row = {'id': 'a', 'series_id': 'X', 'system': 'APP_LIVE_CHECK', 'pred': 'CONTRADICTS',
               'gold_label': 'OUTDATED', 'alert': True, 'expected_alert': True}
        other = {**row, 'system': 'M2'}
        result = A.compare([row], [other], 'M2')
        self.assertEqual(result['mcnemar_alert']['exact_p'], 1)
        with self.assertRaises(ValueError):
            A.compare([row], [{**other, 'id': 'different'}], 'M2')


if __name__ == '__main__':
    unittest.main()
