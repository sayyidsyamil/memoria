import json
from pathlib import Path
import tempfile
import unittest
import uuid
from engine import Engine, workspace_product

class WorkspaceProductTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.engine = Engine(self.root)
    def tearDown(self):
        self.engine.db.close()
        self.directory.cleanup()
    def run_action(self, action, **kwargs):
        return workspace_product(self.engine, {'action': action, **kwargs})
    def test_meeting_survives_restart_and_preserves_external_edits(self):
        (self.root/'audio.wav').write_bytes(b'audio')
        identifier = str(uuid.uuid4())
        saved = self.run_action('save_meeting', record={'id':identifier,'title':'Pilot review','status':'needs-review','audioPath':'audio.wav',
            'turns':[{'start':1.,'end':2.,'speaker':'S01','text':'Launch Thursday'}], 'names':{'S01':'Maya'}})
        self.engine.db.close(); self.engine = Engine(self.root)
        restored = self.run_action('meeting_record',id=identifier)
        self.assertEqual(restored['names']['S01'],'Maya')
        path = self.root/saved['pagePath']
        self.assertIn('Maya: Launch Thursday',path.read_text())
        path.write_text(path.read_text()+'\nPersonal note\n')
        with self.assertRaisesRegex(ValueError,'edited externally'):
            self.run_action('save_meeting',record={'id':identifier,'title':'Changed','status':'needs-review'})
        self.assertIn('Personal note',path.read_text())
    def test_approved_includes_accepted_claims_and_flags_changed_source(self):
        (self.root/'source.md').write_text('---\ntype: Source\ntitle: Evidence\n---\n# Evidence\n## Page 1\n\nLaunch Thursday confirmed by Maya.\n')
        claim={'title':'Launch','kind':'Decision','statement':'Launch Thursday.','evidenceId':'E1','quote':'Launch Thursday confirmed by Maya.','targetPath':None}
        proposal=self.engine.compile('source.md',generator=lambda _:json.dumps({'claims':[claim]}))
        self.engine.apply(proposal['id'])
        approved=self.run_action('approved')
        self.assertEqual(len(approved),1)
        self.assertEqual(approved[0]['knowledgePath'],'knowledge/decision-launch.md')
        self.assertEqual(approved[0]['status'],'source-unchanged')
        (self.root/'source.md').write_text('Changed evidence')
        self.assertEqual(self.run_action('approved')[0]['status'],'needs-review')
        self.engine.undo(proposal['id'])
        self.assertEqual(self.run_action('approved'),[])
    def test_saved_brief_is_cited_and_idempotent(self):
        (self.root/'source.md').write_text('---\ntype: Source\ntitle: Evidence\n---\n# Evidence\n## Page 1\n\nLaunch Thursday confirmed by Maya.\n')
        claim={'title':'Launch','kind':'Decision','statement':'Launch Thursday.','evidenceId':'E1','quote':'Launch Thursday confirmed by Maya.','targetPath':None}
        proposal=self.engine.compile('source.md',generator=lambda _:json.dumps({'claims':[claim]}))
        self.engine.apply(proposal['id'])
        result={'sections':[{'heading':'Context','items':[{'text':'Launch Thursday.','citations':['C1']}]}],
            'citations':[{'id':'C1','sourcePath':'source.md','sourceTitle':'Evidence','page':1,'quote':'Launch Thursday confirmed by Maya.',
                'proposalId':proposal['id'],'sourceHash':proposal['sourceHash']}], 'warnings':[]}
        identifier=str(uuid.uuid4())
        saved=self.run_action('save_brief',id=identifier,topic='Pilot',result=result)
        self.assertEqual(self.run_action('save_brief',id=identifier,topic='Pilot',result=result),saved)
        content=(self.root/saved['pagePath']).read_text()
        self.assertIn('../source.md#page-1',content)
        self.assertEqual(len(self.run_action('briefs')),1)
        with self.assertRaises(ValueError):self.run_action('save_brief',id=identifier,topic='Different',result=result)
        (self.root/'source.md').write_text((self.root/'source.md').read_text()+'\nPilot cancelled.\n')
        with self.assertRaisesRegex(ValueError,'evidence changed'):
            self.run_action('save_brief',id=str(uuid.uuid4()),topic='Pilot',result=result)
        result['citations'][0]['quote']='Invented quote'
        with self.assertRaisesRegex(ValueError,'evidence changed'):
            self.run_action('save_brief',id=str(uuid.uuid4()),topic='Pilot',result=result)

    def test_edited_draft_invalidates_reviewed_state_without_deleting_evidence(self):
        (self.root/'audio.wav').write_bytes(b'audio')
        (self.root/'reviewed.md').write_text('Reviewed evidence')
        identifier=str(uuid.uuid4())
        self.run_action('save_meeting',record={'id':identifier,'title':'Review','status':'transcript-reviewed',
            'audioPath':'audio.wav','transcriptPath':'reviewed.md'})
        edited=self.run_action('save_meeting',record={'id':identifier,'status':'needs-review','transcriptPath':None})
        self.assertEqual(edited['status'],'needs-review')
        self.assertIsNone(edited['transcriptPath'])
        self.assertTrue((self.root/'reviewed.md').exists())

    def test_quote_repair_is_bounded_and_still_requires_exact_evidence(self):
        (self.root/'source.md').write_text('---\ntype: Source\ntitle: Evidence\n---\n## Page 1\nLaunch Thursday confirmed by Maya.\n')
        claim={'title':'Launch','kind':'Decision','statement':'Launch Thursday.','evidenceId':'E1','quote':'Maya confirmed a Thursday launch.','targetPath':None}
        responses=iter([json.dumps({'claims':[claim]}),json.dumps({'claims':[{**claim,'quote':'Launch Thursday confirmed by Maya.'}]})])
        proposal=self.engine.compile('source.md',generator=lambda _:next(responses))
        self.assertEqual(proposal['claims'][0]['quote'],'Launch Thursday confirmed by Maya.')
        self.engine.db.execute("UPDATE proposals SET status='rejected' WHERE id=?", (proposal['id'],))
        self.engine.db.commit()
        calls=[]
        def invalid(prompt):
            calls.append(prompt)
            return json.dumps({'claims':[claim]})
        with self.assertRaisesRegex(ValueError,'quote does not match'):
            self.engine.compile('source.md',generator=invalid)
        self.assertEqual(len(calls),2)

    def test_destination_context_does_not_supply_other_source_facts(self):
        (self.root/'source.md').write_text('---\ntype: Source\ntitle: Current\n---\n## Page 1\nCedar pilot starts Thursday.\n')
        (self.root/'other.md').write_text('---\ntype: Source\ntitle: Other\n---\nOther secret launch facts.')
        (self.root/'decision.md').write_text('---\ntype: Decision\ntitle: Existing decision\n---\n# Existing decision\nPreviously reviewed secret facts.')
        prompts=[]
        self.engine.compile('source.md',generator=lambda prompt: prompts.append(prompt) or '{"claims":[]}')
        self.assertNotIn('Other secret launch facts',prompts[0])
        self.assertNotIn('Previously reviewed secret facts',prompts[0])
        self.assertIn('Existing decision',prompts[0])

    def test_explicit_project_brief_keeps_sibling_claims_and_excludes_other_projects(self):
        for filename, text in [('cedar.md','Project Cedar pilot Thursday. Maya sends checklist Wednesday.'),('harbour.md','Harbour pilot Friday.')]:
            (self.root/filename).write_text('---\ntype: Source\n---\n## Page 1\n'+text)
        def compile_claims(path, claims):
            proposal=self.engine.compile(path,generator=lambda _:json.dumps({'claims':claims}))
            self.engine.apply(proposal['id'])
        def claim(title,quote,kind='Project'):
            return {'title':title,'kind':kind,'statement':quote,'quote':quote,'evidenceId':'E1','targetPath':None}
        compile_claims('cedar.md',[claim('Cedar','Project Cedar pilot Thursday.'),claim('Checklist','Maya sends checklist Wednesday.','Commitment')])
        compile_claims('harbour.md',[claim('Harbour','Harbour pilot Friday.')])
        prompts=[]
        headings=['Context','Open commitments','Recent updates','Relevant people','Risks and open questions','Suggested questions']
        self.engine.answer('Project Cedar pilot',brief=True,generator=lambda prompt:prompts.append(prompt) or json.dumps({'sections':[{'heading':heading,'items':[]} for heading in headings]}))
        self.assertIn('Maya sends checklist Wednesday',prompts[0])
        self.assertNotIn('Harbour pilot Friday',prompts[0])

    def test_saved_brief_omits_empty_sections_and_survives_crash_retry(self):
        (self.root/'source.md').write_text('---\ntype: Source\ntitle: Evidence\n---\n# Evidence\n## Page 1\n\nLaunch Thursday confirmed by Maya.\n')
        claim={'title':'Launch','kind':'Decision','statement':'Launch Thursday.','evidenceId':'E1','quote':'Launch Thursday confirmed by Maya.','targetPath':None}
        proposal=self.engine.compile('source.md',generator=lambda _:json.dumps({'claims':[claim]}))
        self.engine.apply(proposal['id'])
        evidence={'id':'R1','sourcePath':'source.md','sourceTitle':'Evidence','page':1,'quote':'Launch Thursday confirmed by Maya.','proposalId':proposal['id'],'sourceHash':proposal['sourceHash']}
        result={'sections':[{'heading':'Context','items':[{'text':'Launch Thursday.','citations':['R1']}]},{'heading':'Risks and open questions','items':[]}],'citations':[evidence],'warnings':[]}
        identifier=str(uuid.uuid4()); prepared='2026-11-01T03:22:43+00:00'
        saved=self.run_action('save_brief',id=identifier,topic='Pilot',result=result,prepared=prepared)
        content=(self.root/saved['pagePath']).read_text()
        self.assertNotIn('Risks and open questions',content)
        self.assertIn('Prepared 1 Nov 2026',content)
        self.assertIn('1 cited statement',content)
        self.assertNotIn('T03:22:43.',content.split('---',2)[2])
        self.engine.db.execute('DELETE FROM briefs WHERE id=?',(identifier,)); self.engine.db.commit()
        self.assertEqual(self.run_action('save_brief',id=identifier,topic='Pilot',result=result,prepared=prepared)['pageHash'],saved['pageHash'])
        empty={**result,'sections':[{'heading':'Context','items':[]}]}
        with self.assertRaisesRegex(ValueError,'no cited statements'):
            self.run_action('save_brief',id=str(uuid.uuid4()),topic='Pilot',result=empty)

    def test_summary_meeting_status_and_readable_meeting_page(self):
        (self.root/'audio.wav').write_bytes(b'audio'); (self.root/'transcript.md').write_text('---\ntype: Source\n---\n## Page 1\n\nLaunch Thursday confirmed by Maya.\n')
        identifier=str(uuid.uuid4())
        saved=self.run_action('save_meeting',record={'id':identifier,'title':'Pilot review','status':'transcript-reviewed','audioPath':'audio.wav','transcriptPath':'transcript.md',
            'created':'2026-11-01T03:05:57+00:00','turns':[{'start':65.4,'end':70,'speaker':'unassigned','text':'Unknown voice'},{'start':80,'end':82,'speaker':'S02','text':'Second voice'}],'names':{}})
        page=(self.root/saved['pagePath']).read_text()
        self.assertIn('[1:05] Unknown speaker: Unknown voice',page)
        self.assertIn('[1:20] Speaker 2: Second voice',page)
        self.assertIn('Transcript reviewed · Recorded 1 Nov 2026',page)
        self.assertEqual(self.run_action('meeting_record',id=identifier)['outcomesStatus'],'not-built')
        claim={'title':'Launch','kind':'Decision','statement':'Launch Thursday.','evidenceId':'E1','quote':'Launch Thursday confirmed by Maya.','targetPath':None}
        proposal=self.engine.compile('transcript.md',generator=lambda _:json.dumps({'claims':[claim]}))
        self.assertEqual(self.run_action('meeting_record',id=identifier)['outcomesStatus'],'needs-review')
        self.assertEqual(self.run_action('summary'),{'meetings':1,'briefs':0,'approved':0,'sourceChanged':0,'pendingReviews':1})
        self.engine.apply(proposal['id'])
        summary=self.run_action('summary')
        self.assertEqual((summary['approved'],summary['pendingReviews']),(1,0))
        self.assertEqual(self.run_action('meeting_record',id=identifier)['outcomesStatus'],'approved')
        approved=self.run_action('approved')
        self.assertEqual(approved[0]['pageTitle'],'Launch')
        self.assertTrue(approved[0]['approvedAt'])

    def make_reviewed_meeting(self, title='Pilot review', turns=None, names=None, created='2026-11-01T03:05:57+00:00'):
        (self.root/'audio.wav').write_bytes(b'audio')
        turns = turns or [{'start':20,'end':25,'speaker':'S01','text':'Project Cedar will run its pilot on Thursday.'},
                          {'start':65,'end':70,'speaker':'S02','text':'Maya will send the checklist by Wednesday.'}]
        identifier = str(uuid.uuid4())
        body = '\n\n'.join(f"[{int(turn['start'])//60}:{int(turn['start'])%60:02d}] Speaker: {turn['text']}" for turn in turns)
        (self.root/f'transcript-{identifier}.md').write_text(f"---\ntype: Source\ntitle: {title} — reviewed transcript\n---\n# {title}\n## Page 1\n\n{body}\n")
        saved = self.run_action('save_meeting', record={'id':identifier,'title':title,'status':'transcript-reviewed','audioPath':'audio.wav',
            'transcriptPath':f'transcript-{identifier}.md','created':created,'turns':turns,'names':names or {'S01':'Maya','S02':'Alex'}})
        return identifier, saved

    def approve(self, source, claims):
        proposal = self.engine.compile(source, generator=lambda _: json.dumps({'claims': claims}))
        self.engine.apply(proposal['id'])
        return proposal

    def test_marked_moments_are_validated_sorted_and_written_to_the_page(self):
        identifier, saved = self.make_reviewed_meeting()
        marked = self.run_action('save_meeting', record={'id':identifier,'title':'Pilot review','audioPath':'audio.wav','transcriptPath':saved['transcriptPath'],
            'marks':[{'at':65.2,'label':'Checklist'},{'id':'fixed','at':20,'label':''}]})
        self.assertEqual([mark['at'] for mark in marked['marks']], [20.0, 65.2])
        self.assertEqual(marked['marks'][0]['id'], 'fixed')
        page = (self.root/marked['pagePath']).read_text()
        self.assertIn('## Marked moments', page); self.assertIn('- 0:20 — Marked moment', page); self.assertIn('- 1:05 — Checklist', page)
        for bad in [[{'at': -1, 'label': 'x'}], [{'at': float('inf'), 'label': 'x'}], [{'at': True, 'label': 'x'}], [{'at': 1, 'label': 'x' * 121}], 'not a list', [{'label': 'missing time'}]]:
            with self.assertRaisesRegex(ValueError, 'marked moment'):
                self.run_action('save_meeting', record={'id':identifier,'title':'Pilot review','audioPath':'audio.wav','transcriptPath':saved['transcriptPath'],'marks':bad})

    def test_legacy_status_is_derived_from_the_reviewed_transcript(self):
        identifier, saved = self.make_reviewed_meeting()
        row = json.loads(self.engine.db.execute('SELECT record FROM meetings WHERE id=?', (identifier,)).fetchone()[0])
        row['status'] = 'needs-review'   # inconsistent record written by an older build
        self.engine.db.execute('UPDATE meetings SET record=? WHERE id=?', (json.dumps(row), identifier)); self.engine.db.commit()
        self.assertEqual(self.run_action('meeting_record', id=identifier)['status'], 'transcript-reviewed')
        self.assertEqual(self.run_action('meetings')[0]['status'], 'transcript-reviewed')
        edited = self.run_action('save_meeting', record={'id':identifier,'title':'Pilot review','audioPath':'audio.wav','transcriptPath':None})
        self.assertEqual(edited['status'], 'needs-review')

    def test_claims_and_answers_link_back_to_the_moment_in_the_transcript(self):
        identifier, saved = self.make_reviewed_meeting()
        claims = [{'title':'Cedar pilot','kind':'Project','statement':'Cedar pilot runs Thursday.','evidenceId':'E1','quote':'Project Cedar will run its pilot on Thursday.','targetPath':None},
                  {'title':'Checklist','kind':'Commitment','statement':'Maya sends the checklist.','evidenceId':'E2','quote':'[1:05] Speaker: Maya will send the checklist by Wednesday.','targetPath':None}]
        self.approve(saved['transcriptPath'], claims)
        moments = {item['title']: item['moment'] for item in self.run_action('approved')}
        self.assertEqual(moments['Cedar pilot'], {'meetingId': identifier, 'meetingTitle': 'Pilot review', 'at': 20.0})
        self.assertEqual(moments['Checklist']['at'], 65.0)
        result = self.engine.answer('Cedar pilot Thursday', generator=lambda _: json.dumps({'sections':[{'heading':'Answer','items':[{'text':'Thursday.','citations':['R1']}]}]}))
        self.assertEqual(result['citations'][0]['moment']['meetingId'], identifier)

    def test_answers_can_be_scoped_to_one_meeting(self):
        first, saved = self.make_reviewed_meeting('Cedar kickoff')
        second, other = self.make_reviewed_meeting('Harbour review', turns=[{'start':3,'end':5,'speaker':'S01','text':'Harbour pilot launches Friday.'}])
        self.approve(saved['transcriptPath'], [{'title':'Cedar pilot','kind':'Project','statement':'Cedar pilot runs Thursday.','evidenceId':'E1','quote':'Project Cedar will run its pilot on Thursday.','targetPath':None}])
        self.approve(other['transcriptPath'], [{'title':'Harbour pilot','kind':'Project','statement':'Harbour pilot launches Friday.','evidenceId':'E1','quote':'Harbour pilot launches Friday.','targetPath':None}])
        prompts = []
        reply = lambda prompt: prompts.append(prompt) or json.dumps({'sections':[{'heading':'Answer','items':[]}]})
        self.engine.answer('pilot', generator=reply, scope=[saved['transcriptPath']])
        self.assertIn('Cedar pilot runs Thursday', prompts[0]); self.assertNotIn('Harbour pilot launches Friday', prompts[0])
        everything = self.engine.answer('pilot', generator=reply)
        self.assertEqual(len(everything['citations']), 2)
        empty = self.engine.answer('pilot', generator=reply, scope=['missing.md'])
        self.assertIn('No reviewed evidence', empty['message'])

    def test_search_finds_transcript_lines_and_claims_with_speaker_and_date_filters(self):
        first, saved = self.make_reviewed_meeting('Pricing review', turns=[
            {'start':14,'end':18,'speaker':'S01','text':'At fourteen, churn would need to stay under four.'},
            {'start':40,'end':44,'speaker':'S02','text':'Lunch plans for Friday.'}], names={'S01':'Priya','S02':'Sam'}, created='2026-09-22T10:00:00+00:00')
        second, older = self.make_reviewed_meeting('Board prep', turns=[{'start':362,'end':370,'speaker':'S01','text':"I'd lead with the churn number before the hiring plan."}],
            names={'S01':'Priya'}, created='2026-07-29T10:00:00+00:00')
        self.approve(saved['transcriptPath'], [{'title':'Churn guardrail','kind':'Decision','statement':'Churn must stay under four percent.','evidenceId':'E1','quote':'At fourteen, churn would need to stay under four.','targetPath':None}])
        found = self.run_action('search', query='the churn number priya mentioned')
        self.assertEqual([line['title'] for line in found['lines']][:2], ['Board prep', 'Pricing review'])  # churn+number+priya beats churn+priya
        self.assertEqual(found['lines'][0]['label'], 'Priya'); self.assertEqual(found['lines'][0]['at'], 362.0)
        self.assertTrue(found['lines'][0]['reviewed'])
        self.assertEqual(found['claims'][0]['title'], 'Churn guardrail')
        self.assertEqual(found['speakers'], ['Priya', 'Sam'])
        self.assertEqual(self.run_action('search', query='churn', speaker='Sam')['lines'], [])
        recent = self.run_action('search', query='churn', since='2026-09-01T00:00:00+00:00')
        self.assertEqual([line['title'] for line in recent['lines']], ['Pricing review'])
        self.assertEqual(self.run_action('search', query='   ')['lines'], [])
        with self.assertRaisesRegex(ValueError, '500 characters'):
            self.run_action('search', query='x' * 501)

if __name__=='__main__':unittest.main()
