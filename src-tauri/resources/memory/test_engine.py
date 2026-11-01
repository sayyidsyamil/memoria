import json
from pathlib import Path
import tempfile
import unittest
from engine import Engine, safe_path, validate_claim, parse_model_json

SOURCE = '---\ntype: Source\n---\n# Review\n\n## Page 1\n\nMaya confirmed launch on 19 November.\n'

def model(prompt):
    return json.dumps({'claims': [{'title': 'Launch date', 'kind': 'Decision',
        'statement': 'Maya confirmed launch on 19 November.', 'evidenceId': 'E1',
        'quote': 'Maya confirmed launch on 19 November.', 'targetPath': 'launch.md'}]})

class MemoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        (self.root / 'source.md').write_text(SOURCE)
        (self.root / 'launch.md').write_text('---\ntype: Decision\n---\n# Launch date\n\nUser correction: original target was conditional.\n')
        self.engine = Engine(self.root)

    def tearDown(self):
        self.engine.db.close()
        self.temp.cleanup()

    def test_review_publish_preserves_user_text_and_sources(self):
        with self.engine.locked():
            proposal = self.engine.compile('source.md', model)
            self.assertNotIn('Evidence update', (self.root / 'launch.md').read_text())
            result = self.engine.apply(proposal['id'])
            self.assertEqual(result['status'], 'applied')
            self.assertIn('User correction', (self.root / 'launch.md').read_text())
            self.assertIn('source.md#page-1', (self.root / 'launch.md').read_text())
            self.assertEqual((self.root / 'source.md').read_text(), SOURCE)
            self.assertTrue((self.root / 'index.md').exists())
            self.assertEqual(self.engine.apply(proposal['id'])['status'], 'applied')

    def test_stale_destination_rejected(self):
        proposal = self.engine.compile('source.md', model)
        (self.root / 'launch.md').write_text('User edited this while reviewing.')
        with self.assertRaisesRegex(ValueError, 'changed since compilation'):
            self.engine.apply(proposal['id'])

    def test_quote_and_path_validation(self):
        with self.assertRaises(ValueError):
            safe_path(self.root, '../outside.md')
        claim = json.loads(model(''))['claims'][0]
        claim['quote'] = 'Invented supporting sentence'
        with self.assertRaisesRegex(ValueError, 'does not match'):
            validate_claim(claim, [{'id': 'E1', 'text': 'Actual evidence', 'page': 1}], [])

    def test_recompile_replaces_stale_pending_proposal(self):
        proposal = self.engine.compile('source.md', model)
        with (self.root / 'launch.md').open('a') as out:
            out.write('\nNew user context.\n')
        replacement = self.engine.compile('source.md', model)
        self.assertNotEqual(proposal['id'], replacement['id'])
        statuses = {item['id']: item['status'] for item in self.engine.list()}
        self.assertEqual(statuses[proposal['id']], 'stale')
        self.engine.apply(replacement['id'])

    def test_interrupted_publication_recovers(self):
        proposal = self.engine.compile('source.md', model)
        original = (self.root / 'launch.md').read_text()
        self.engine.db.execute('insert into writes values(?,?,?,?)', (proposal['id'], 'launch.md', original, 'Partial write'))
        self.engine.db.execute("update proposals set status='applying' where id=?", (proposal['id'],))
        self.engine.db.commit()
        (self.root / 'launch.md').write_text('Partial write')
        self.engine.recover()
        self.assertEqual((self.root / 'launch.md').read_text(), original)

    def test_review_edit_and_undo(self):
        proposal = self.engine.compile('source.md', model)
        original = (self.root / 'launch.md').read_text()
        self.engine.review(proposal['id'], [{'statement': 'Reviewed: Maya confirmed 19 November.', 'accepted': True}])
        self.engine.apply(proposal['id'])
        self.assertIn('Reviewed: Maya', (self.root / 'launch.md').read_text())
        self.engine.undo(proposal['id'])
        self.assertEqual((self.root / 'launch.md').read_text(), original)
        self.assertFalse((self.root / 'index.md').exists())

    def test_undo_preserves_newer_edits(self):
        proposal = self.engine.compile('source.md', model)
        self.engine.apply(proposal['id'])
        with (self.root / 'launch.md').open('a') as out:
            out.write('New user work')
        with self.assertRaisesRegex(ValueError, 'preserve newer edits'):
            self.engine.undo(proposal['id'])
        self.assertIn('New user work', (self.root / 'launch.md').read_text())

    def test_answer_only_uses_reviewed_unchanged_sources(self):
        self.assertEqual(self.engine.answer('When?')['sections'], [])
        proposal = self.engine.compile('source.md', model)
        self.engine.apply(proposal['id'])
        def answer_model(prompt):
            return json.dumps({'sections': [{'heading': 'Answer', 'items': [{'text': '19 November', 'citations': ['R1']}]}]})
        result = self.engine.answer('When is launch?', generator=answer_model)
        self.assertEqual(result['citations'][0]['sourcePath'], 'source.md')
        (self.root / 'source.md').write_text(SOURCE + '\nChanged')
        self.assertEqual(self.engine.answer('When?')['sections'], [])

    def test_wrapped_pdf_quote_is_canonicalised_to_the_exact_source_span(self):
        claim = json.loads(model(''))['claims'][0]
        claim['quote'] = 'Maya confirmed launch on 12 November,conditional on document validation.'
        unit = {'id': 'E1', 'text': 'Maya confirmed launch on 12 November,\nconditional on document validation.', 'page': 2}
        validated = validate_claim(claim, [unit], [{'path': 'launch.md', 'kind': 'Decision'}])
        self.assertEqual(validated['quote'], 'Maya confirmed launch on 12 November,\nconditional on document validation.')
        claim['quote'] = 'Maya confirmed launch on 12 December, conditional on document validation.'
        with self.assertRaisesRegex(ValueError, 'does not match'):
            validate_claim(claim, [unit], [])

    def test_front_matter_edits_do_not_invalidate_reviewed_source(self):
        proposal = self.engine.compile('source.md', model)
        source = self.root / 'source.md'
        source.write_text(source.read_text().replace('type: Source\n', 'type: Source\n_favorite: true\n', 1))
        self.assertEqual(self.engine.apply(proposal['id'])['status'], 'applied')
        answer = self.engine.answer('When is launch?', generator=lambda prompt: json.dumps({'sections': [{'heading': 'Answer', 'items': [{'text': '19 November', 'citations': ['R1']}]}]}))
        self.assertEqual(answer['warnings'], [])
        self.assertEqual(len(answer['sections']), 1)
        source.write_text(source.read_text() + '\nChanged evidence.')
        self.assertEqual(self.engine.answer('When?')['sections'], [])

    def test_legacy_whole_page_source_hashes_are_upgraded_while_unchanged(self):
        from engine import digest
        proposal = self.engine.compile('source.md', model)
        legacy = dict(proposal, sourceHash=digest(SOURCE))
        self.engine.db.execute('update proposals set payload=? where id=?', (json.dumps(legacy), proposal['id']))
        self.engine.db.commit()
        with self.engine.locked():
            pass
        upgraded = next(item for item in self.engine.list() if item['id'] == proposal['id'])
        self.assertNotEqual(upgraded['sourceHash'], digest(SOURCE))
        source = self.root / 'source.md'
        source.write_text(source.read_text().replace('type: Source\n', 'type: Source\n_favorite: true\n', 1))
        self.assertEqual(self.engine.apply(proposal['id'])['status'], 'applied')

    def test_recompile_after_source_change_retires_the_old_pending_proposal(self):
        old = self.engine.compile('source.md', model)
        source = self.root / 'source.md'
        source.write_text(source.read_text() + '\nAdditional evidence line.\n')
        fresh = self.engine.compile('source.md', model)
        self.assertNotEqual(old['id'], fresh['id'])
        statuses = {item['id']: item['status'] for item in self.engine.list()}
        self.assertEqual(statuses[old['id']], 'stale')
        self.assertEqual(statuses[fresh['id']], 'pending')
        with self.assertRaisesRegex(ValueError, 'no longer pending'):
            self.engine.apply(old['id'])

    def test_changed_newer_source_cannot_promote_older_launch_date(self):
        self.engine.apply(self.engine.compile('source.md', model)['id'])
        newer = self.root / 'newer.md'
        newer.write_text('---\ntype: Source\n---\n# Later review\n\n## Page 1\n\nMaya moved launch to 26 November.\n')
        def newer_model(prompt):
            return json.dumps({'claims': [{'title': 'Launch date', 'kind': 'Decision',
                'statement': 'Maya moved launch to 26 November.', 'quote': 'Maya moved launch to 26 November.',
                'evidenceId': 'E1', 'targetPath': 'launch.md'}]})
        self.engine.apply(self.engine.compile('newer.md', newer_model)['id'])
        newer.write_text(newer.read_text() + '\nChanged evidence.')
        def forbidden(prompt):
            self.fail('Generator must not answer from the older date')
        for brief in [False, True]:
            result = self.engine.answer('What is the current launch date?', brief=brief, generator=forbidden)
            self.assertEqual(result['sections'], [])
            self.assertEqual(result['citations'], [])
            self.assertEqual(result['needsReview'][0]['sourcePath'], 'newer.md')
        newer.unlink()
        self.assertTrue(self.engine.answer('When is launch?', generator=forbidden)['needsReview'])

    def test_unrelated_stale_evidence_does_not_block_a_supported_answer(self):
        self.engine.apply(self.engine.compile('source.md', model)['id'])
        other = self.root / 'budget.md'
        other.write_text('---\ntype: Source\n---\n# Budget\n\n## Page 1\n\nThe approved budget is forty pounds.\n')
        def budget_model(prompt):
            return json.dumps({'claims': [{'title': 'Budget approval', 'kind': 'Decision',
                'statement': 'The approved budget is forty pounds.', 'quote': 'The approved budget is forty pounds.',
                'evidenceId': 'E1', 'targetPath': None}]})
        self.engine.apply(self.engine.compile('budget.md', budget_model)['id'])
        other.unlink()
        answer = lambda prompt: json.dumps({'sections': [{'heading': 'Answer', 'items': [{'text': '19 November', 'citations': ['R1']}]}]})
        result = self.engine.answer('When is launch?', generator=answer)
        self.assertEqual(len(result['sections']), 1)

    def test_model_json_tolerates_fences_prose_and_missing_final_brackets(self):
        self.assertEqual(parse_model_json('```json\n{"a": [1, 2]}\n```'), {'a': [1, 2]})
        self.assertEqual(parse_model_json('Here you go: {"a": 1}'), {'a': 1})
        self.assertEqual(parse_model_json('{"sections":[{"heading":"Answer","items":[{"text":"x {y}","citations":["R1"]}]}]'),
            {'sections': [{'heading': 'Answer', 'items': [{'text': 'x {y}', 'citations': ['R1']}]}]})
        self.assertEqual(parse_model_json('{"a": [1, 2'), {'a': [1, 2]})
        with self.assertRaisesRegex(ValueError, 'unreadable answer'):
            parse_model_json('not json at all')

    def test_answer_accepts_unclosed_json_no_evidence_items_and_drops_leaked_fields(self):
        self.engine.apply(self.engine.compile('source.md', model)['id'])
        unclosed = '{"sections":[{"heading":"Answer","items":[{"text":"19 November","citations":["R1"]},{"text":"sourcePath: source.md","citations":["R1"]},{"text":"19 November","citations":["R1"]}]}]'
        result = self.engine.answer('When is launch?', generator=lambda prompt: unclosed)
        self.assertEqual([item['text'] for item in result['sections'][0]['items']], ['19 November'])
        none = json.dumps({'sections': [{'heading': 'Answer', 'items': [{'text': 'The reviewed knowledge does not answer this.', 'citations': [], 'noEvidence': True}]}]})
        result = self.engine.answer('When is launch?', generator=lambda prompt: none)
        self.assertEqual(result['sections'][0]['items'][0]['citations'], [])
        uncited = json.dumps({'sections': [{'heading': 'Answer', 'items': [{'text': 'Invented fact', 'citations': []}]}]})
        with self.assertRaisesRegex(ValueError, 'missing or unknown source citations'):
            self.engine.answer('When is launch?', generator=lambda prompt: uncited)

if __name__ == '__main__':
    unittest.main()
