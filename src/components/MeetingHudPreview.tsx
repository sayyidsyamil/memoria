import { MeetingHudView } from './MeetingHudView'

/**
 * Development only (`?hudPreview` on the Vite dev server): the meeting window at the moment a statement contradicts an
 * approved decision, with fixture data from the fictional UAT series, for screenshots and design review.
 */
export function MeetingHudPreview() {
  const turns = [
    { speaker: 'S01', start: 61, end: 66, text: 'Before we close the pilot plan, one thing about the vendor.' },
    { speaker: 'S02', start: 67, end: 71, text: 'Gamma Solutions is our vendor now.' },
    { speaker: 'S03', start: 72, end: 75, text: 'I thought we moved to Beta Cloud in September.' },
    { speaker: 'S01', start: 76, end: 79, text: 'The go-live date is still the 9th of November.' },
    { speaker: 'S02', start: 80, end: 84, text: 'And the pilot budget is now 300,000 ringgit.' },
  ]
  const vendor = {
    factId: 5, label: 'Vendor', attribute: 'outcome', currentValue: 'Beta Cloud',
    quote: 'We drop Alpha Systems and move to Beta Cloud. This is final.', speaker: 'Aisha',
    meeting: 'preview', at: 39.84, reason: 'The statement names Gamma Solutions as the vendor, but the approved decision is Beta Cloud.', heardAt: 67,
  }
  const budget = {
    factId: 9, label: 'Pilot budget (RM)', attribute: 'amount', currentValue: 280000,
    quote: "Beta Cloud's licence is 30,000 ringgit higher, so the pilot budget has to go from 250,000 to 280,000 ringgit.", speaker: 'Raj',
    meeting: 'preview', at: 52.25, reason: 'The statement sets the pilot budget at 300,000 ringgit; the approved current value is 280,000.', heardAt: 80,
  }
  return <MeetingHudView state="recording" saveStage="" seconds={86} levels={Array.from({ length: 48 }, (_, index) => 0.2 + 0.6 * Math.abs(Math.sin(index / 3)))}
    prep={0} captionsOpen liveTurns={turns} vaultPath="/preview" transcriptRef={view => { if (view) view.scrollTop = view.scrollHeight }} caption="" captionError="" marks={[]} markNotice="" error=""
    assistanceEnabled onToggleAssistance={() => undefined} liveCues={[budget, vendor]} progressText="0.0s queued · 86.0s acknowledged" assistanceNotice=""
    cueMeetingTitles={new Map([['preview', 'Procurement pilot progress check']])}
    onToggleCaptions={() => undefined} onOpenWorkspace={() => undefined} onPause={() => undefined} onEnd={() => undefined} onMark={() => undefined} />
}
