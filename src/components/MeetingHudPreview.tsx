import { MeetingHudView } from './MeetingHudView'

/**
 * Development only (`?hudPreview` on the Vite dev server): the meeting window at the moment a statement contradicts an
 * approved decision, with fixture data from the fictional UAT series, for screenshots and design review.
 */
export function MeetingHudPreview() {
  const turns = [
    { speaker: 'S01', start: 61, end: 66, text: 'Before we close the pilot plan, one thing about the vendor.' },
    { speaker: 'S02', start: 67, end: 71, text: 'Gamma Solutions is our vendor now.' },
  ]
  const cue = {
    factId: 5, label: 'Vendor', attribute: 'outcome', currentValue: 'Beta Cloud',
    quote: 'We drop Alpha Systems and move to Beta Cloud. This is final.', speaker: 'Aisha',
    meeting: 'preview', at: 39.84, reason: 'The statement names Gamma Solutions as the vendor, but the approved decision is Beta Cloud.',
  }
  return <MeetingHudView state="recording" saveStage="" seconds={73} levels={Array.from({ length: 48 }, (_, index) => 0.2 + 0.6 * Math.abs(Math.sin(index / 3)))}
    prep={0} captionsOpen liveTurns={turns} caption="" captionError="" marks={[]} markNotice="" error=""
    assistanceEnabled onToggleAssistance={() => undefined} liveCues={[cue]} assistanceNotice=""
    cueMeetingTitles={new Map([['preview', 'Procurement pilot progress check']])}
    onToggleCaptions={() => undefined} onOpenWorkspace={() => undefined} onPause={() => undefined} onEnd={() => undefined} onMark={() => undefined} />
}
