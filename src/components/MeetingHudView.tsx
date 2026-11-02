import type { ReactNode, Ref, UIEvent } from 'react'
import { ArrowsOutSimple, CaretUp, Check, Flag, Headset, Microphone, Pause, Play, SpinnerGap, Stop, WarningCircle, X } from '@phosphor-icons/react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { TranscriptDraft } from './MeetingTranscriptReview'
import { speakerLabel, speakerOrder, speakerTone } from '../lib/speakers'
import { COMPACT_BARS, PREPARATION_STEPS, clockText } from '../lib/hud'
import { Avatar, LevelMeter } from './memoriaUi'
import './meetingHud.css'
import type { LiveCue } from '../features/temporal/liveAssistanceService'
import { attributeLabel, formatValue, labelUnit, meetingLabel, type MeetingTitles } from '../features/temporal/temporalFormat'
import { LiveAskPanel } from '../features/temporal/LiveAskPanel'
import { meetingTranscript } from '../features/temporal/liveAskService'

export type HudState = 'starting' | 'recording' | 'paused' | 'saving' | 'error'
/** The newest cue that arrived while the window was compact, and how many other new cues it stands for. */
export interface CueToast { cue: LiveCue; more: number }
export type CueToastHold = 'pointer' | 'focus'
export interface HudViewProps {
  sourceKind?: 'microphone' | 'replay'; replayNotice?: string; progressText?: string
  vaultPath?: string
  /** Whether audio playing on this Mac is included; without `onToggleCallAudio` the toggle is not offered. */
  callAudio?: boolean; onToggleCallAudio?: (on: boolean) => void; callAudioStatus?: string; callAudioNotice?: string
  assistanceEnabled?: boolean; onToggleAssistance?: (enabled: boolean) => void; liveCues?: LiveCue[]; assistanceNotice?: string; cueMeetingTitles?: MeetingTitles
  cueToast?: CueToast | null; onHoldCueToast?: (by: CueToastHold, held: boolean) => void; onDismissCueToast?: () => void
  state: HudState; saveStage: string; seconds: number; levels: number[]; prep: number; captionsOpen: boolean
  liveTurns: TranscriptDraft['segments']; partial?: string; caption: string; captionError: string; marks: { at: number; label: string }[]; markNotice: string; error: string; micWait?: boolean
  transcriptRef?: Ref<HTMLDivElement>; onTranscriptScroll?: (event: UIEvent<HTMLDivElement>) => void
  onToggleCaptions: (open: boolean) => void; onOpenWorkspace: () => void; onPause: () => void; onEnd: () => void; onMark: () => void
}

const PLAIN_ATTRIBUTES = new Set(['outcome', 'value', 'amount', 'date'])

/** A cue in words, the same on the card and the toast: the item, its approved value, and who set it where and when. */
function cueText(cue: LiveCue, titles: MeetingTitles = new Map()) {
  const holdsNumber = typeof cue.currentValue === 'number'
  const { title, unit } = labelUnit(cue.label, holdsNumber)
  return {
    name: PLAIN_ATTRIBUTES.has(cue.attribute.toLowerCase()) ? title : `${title} ${attributeLabel(cue.attribute).toLowerCase()}`,
    value: formatValue(cue.currentValue as Parameters<typeof formatValue>[0], holdsNumber ? 'number' : undefined, unit),
    speaker: cue.speaker || 'Unknown speaker', meeting: meetingLabel(cue.meeting, titles), time: typeof cue.at === 'number' ? clockText(Math.floor(cue.at)) : null,
  }
}

/** A statement just made contradicts an approved value: show that value, the words that set it, and who said them when. */
function LiveCueCard({ cue, titles, newest }: { cue: LiveCue; titles?: MeetingTitles; newest?: boolean }): ReactNode {
  const { name, value, speaker, meeting, time } = cueText(cue, titles)
  return <article className="meeting-hud-cue" data-newest={newest || undefined}>
    <p className="meeting-hud-cue-kicker"><WarningCircle size={14} weight="fill" aria-hidden="true" />Earlier decision</p>
    <p className="meeting-hud-cue-value">{name} is <strong>{value}</strong></p>
    <blockquote title={cue.quote}>“{cue.quote}”</blockquote>
    <div className="meeting-hud-cue-meta">
      <small>{[speaker, meeting, time].filter(Boolean).join(' · ')}</small>
      <details><summary>Why this was flagged</summary><p>{cue.reason}</p></details>
    </div>
  </article>
}

/** The newest cue, under the compact notch for a few seconds. Clicking anywhere but its buttons opens the cards. */
function CueToastCard({ toast, titles, onShow, onDismiss, onHold }: { toast: CueToast; titles?: MeetingTitles; onShow: () => void; onDismiss?: () => void; onHold?: (by: CueToastHold, held: boolean) => void }): ReactNode {
  const { name, value, speaker, meeting, time } = cueText(toast.cue, titles)
  return <section className="meeting-hud-toast" aria-label="New earlier decision" onClick={event => { if (!(event.target as HTMLElement).closest('button')) onShow() }}
    onMouseEnter={() => onHold?.('pointer', true)} onMouseLeave={() => onHold?.('pointer', false)}
    onFocus={() => onHold?.('focus', true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) onHold?.('focus', false) }}>
    <div className="meeting-hud-toast-head">
      <p className="meeting-hud-cue-kicker"><WarningCircle size={14} weight="fill" aria-hidden="true" />Earlier decision{toast.more > 0 && <span className="meeting-hud-toast-more">+{toast.more} more</span>}</p>
      <button className="meeting-hud-toast-show" onClick={onShow}>Show</button>
      <button className="meeting-hud-toast-dismiss" aria-label="Dismiss" title="Dismiss" onClick={onDismiss}><X size={12} weight="bold" /></button>
    </div>
    {toast.cue.heard && <p className="meeting-hud-toast-heard" title={toast.cue.heard}>Just said: “{toast.cue.heard}”</p>}
    <p className="meeting-hud-toast-value" title={`${name} is ${value}`}>{name} is <strong>{value}</strong></p>
    <p className="meeting-hud-toast-meta"><span>{speaker}</span><span>{` · ${meeting}`}</span>{time && <span>{` · ${time}`}</span>}</p>
  </section>
}

/** Presentation only: the notch, its preparation steps and the expanded Record view. */
export function MeetingHudView({ state, saveStage, seconds, levels, prep, captionsOpen, liveTurns, partial, caption, captionError, marks, markNotice, error, micWait,
  assistanceEnabled, onToggleAssistance, liveCues, assistanceNotice, cueMeetingTitles, cueToast, onHoldCueToast, onDismissCueToast, vaultPath, sourceKind, replayNotice, progressText,
  callAudio, onToggleCallAudio, callAudioStatus, callAudioNotice,
  transcriptRef, onTranscriptScroll, onToggleCaptions, onOpenWorkspace, onPause, onEnd, onMark }: HudViewProps): ReactNode {
  const liveOrder = speakerOrder(liveTurns.map(turn => turn.speaker))
  const flagged = new Set(liveCues?.map(cue => cue.heardAt))
  // Consecutive turns of one speaker share an avatar; each turn keeps its own paragraph and markers.
  const runs: { speaker: string; turns: { turn: TranscriptDraft['segments'][number]; index: number }[] }[] = []
  liveTurns.forEach((turn, index) => {
    const run = runs[runs.length - 1]
    if (run?.speaker === turn.speaker) run.turns.push({ turn, index })
    else runs.push({ speaker: turn.speaker, turns: [{ turn, index }] })
  })
  const speaking = partial?.trim()
  const statusText = state === 'starting' ? 'Preparing' : state === 'recording' ? 'Recording' : state === 'paused' ? 'Paused' : state === 'saving' ? saveStage : 'Needs attention'
  const capturing = state === 'recording' || state === 'paused'
  const callAudioToggle = onToggleCallAudio && <button className="meeting-hud-control meeting-hud-call-audio" aria-label="Call audio" aria-pressed={!!callAudio}
    title="Also record audio playing on this Mac, such as the other side of a call" disabled={!capturing} onClick={() => onToggleCallAudio(!callAudio)}>
    <Headset size={17} weight={callAudio ? 'fill' : 'regular'} aria-hidden="true" /></button>
  const transcript = <div ref={transcriptRef} className="meeting-hud-transcript" aria-label="Live transcript" aria-live="polite" onScroll={onTranscriptScroll}>
    {runs.map(({ speaker, turns }) => <div className="meeting-hud-live-run" key={`${turns[0].turn.start}-${turns[0].index}`} data-tone={speakerTone(speaker, liveOrder)}>
      <Avatar label={speakerLabel(speaker, undefined, liveOrder)} tone={speakerTone(speaker, liveOrder)} size={28} />
      <div>{turns.map(({ turn, index }) => <p className="meeting-hud-live-turn" key={`${turn.start}-${index}`} data-latest={index === liveTurns.length - 1 || undefined} data-flagged={flagged.has(turn.start) || undefined}>
        <span className="sr-only">{speakerLabel(speaker, undefined, liveOrder)}: </span>{turn.text}</p>)}</div>
    </div>)}
    {!liveTurns.length && (caption || !speaking) && <p className="meeting-hud-empty">{caption || (state === 'saving' ? 'Finishing the remaining audio…' : captionError ? 'No live transcript available.' : 'Listening for speech…')}</p>}
    {/* Uncommitted words change several times a second; the committed turn that follows is the one announced. */}
    {speaking && <p className="meeting-hud-partial" aria-hidden="true">{speaking}</p>}
  </div>
  return <main className="meeting-hud" data-state={state} data-open={captionsOpen || undefined} data-cues={liveCues?.length ? true : undefined}>
    {captionsOpen ? <>
      <div className="meeting-hud-bar" onMouseDown={event => { if (event.button === 0 && !(event.target as HTMLElement).closest('button')) void getCurrentWindow().startDragging() }}>
        <span className="meeting-hud-bar-title"><Microphone size={15} aria-hidden="true" />Memoria</span>
        <div className="meeting-hud-controls">
          {callAudioToggle}
          <button className="meeting-hud-control" aria-label="Open workspace" title="Open workspace" onClick={onOpenWorkspace}><ArrowsOutSimple size={17} /></button>
          <button className="meeting-hud-captions-toggle" aria-label="Toggle live captions" aria-expanded={captionsOpen} title="Collapse to the notch" onClick={() => onToggleCaptions(false)}><CaretUp size={15} /></button>
        </div>
      </div>
      <section className="meeting-hud-record" aria-label="Recording">
        <span className="meeting-hud-pill" role="status"><i />{statusText}</span>
        <div className="meeting-hud-bigtime" aria-label="Meeting duration">{clockText(seconds)}</div>
        <LevelMeter className="meeting-hud-wave" levels={levels} paused={state === 'paused'} />
        {sourceKind === 'replay' && <p className="meeting-hud-hint">Prerecorded audio test · no microphone capture</p>}
        {callAudioStatus && <p role="status" className="meeting-hud-hint">{callAudioStatus}</p>}
        {callAudioNotice && <p role="status" className="meeting-hud-caption-warning">{callAudioNotice}</p>}
        {replayNotice && <p role="status" className="meeting-hud-hint">{replayNotice}</p>}
        {progressText && <p role="status" className="meeting-hud-hint" aria-label="Caption audio progress">{progressText}</p>}
        {onToggleAssistance && <label className="meeting-hud-assistance-toggle"><input type="checkbox" checked={!!assistanceEnabled} onChange={event => onToggleAssistance(event.target.checked)} />Flag statements that contradict a decision</label>}
        {assistanceNotice && <p className="meeting-hud-caption-warning" role="status">{assistanceNotice}</p>}
        {!!liveCues?.length && <section className="meeting-hud-evidence" aria-label="Earlier decisions to check" aria-live="polite">{liveCues.map((cue, index) => <LiveCueCard key={`${cue.factId}:${cue.reason}`} cue={cue} titles={cueMeetingTitles} newest={index === 0} />)}</section>}
        {captionError && <p role="alert" className="meeting-hud-caption-warning">Live transcript paused. Your recording is preserved.</p>}
        {transcript}
        {vaultPath && <LiveAskPanel vaultPath={vaultPath} sessionText={meetingTranscript(liveTurns)} enabled={capturing} />}
        <small className="meeting-hud-hint">{captionError ? <details><summary>Show details</summary>{captionError}</details> : 'Speakers are named after the meeting, in review.'}</small>
      </section>
      <footer className="meeting-hud-actions">
        <button className="meeting-hud-mark" disabled={!capturing} onClick={onMark}><Flag size={15} />Mark moment<kbd>M</kbd></button>
        <span className="meeting-hud-marked" role="status">{markNotice || (marks.length ? `${marks.length} marked` : '')}</span>
        <button className="meeting-hud-pause" disabled={!capturing} onClick={onPause}>{state === 'paused' ? <Play size={15} weight="fill" /> : <Pause size={15} weight="fill" />}{state === 'paused' ? 'Resume' : 'Pause'}</button>
        <button className="meeting-hud-stop" disabled={state === 'saving'} onClick={onEnd}><Stop size={13} weight="fill" />End meeting</button>
      </footer>
    </> : <><div className="meeting-hud-row">
      <div className="meeting-hud-summary" onMouseDown={event => { if (event.button === 0) void getCurrentWindow().startDragging() }}>
        <span className="meeting-hud-signal" aria-hidden="true"><Microphone size={17} weight="regular" /></span>
        <div className="meeting-hud-labels">
          <div className="meeting-hud-title"><span className="meeting-hud-dot" /><span className="meeting-hud-status" role="status">{statusText}</span></div>
          {capturing && <LevelMeter className="meeting-hud-meter" levels={levels.slice(-COMPACT_BARS)} paused={state === 'paused'} />}
        </div>
      </div>
      {state !== 'starting' && <><span className="meeting-hud-time" aria-label="Meeting duration">{clockText(seconds)}</span>
      <span className="meeting-hud-divider" />
      <button className="meeting-hud-captions-toggle" aria-label="Toggle live captions" aria-expanded={captionsOpen} title="Show transcript" onClick={() => onToggleCaptions(true)}>CC</button>
      {!!liveCues?.length && <button className="meeting-hud-cue-badge" aria-label={`${liveCues.length} earlier ${liveCues.length === 1 ? 'decision' : 'decisions'} to check`} title="Something said contradicts an earlier decision" onClick={() => onToggleCaptions(true)}><WarningCircle size={14} weight="fill" aria-hidden="true" />{liveCues.length}</button>}</>}
      <div className="meeting-hud-controls">
        {state !== 'starting' && <>{callAudioToggle}<button className="meeting-hud-control" aria-label="Open workspace" title="Open workspace" onClick={onOpenWorkspace}><ArrowsOutSimple size={17} /></button>
        <button className="meeting-hud-control" aria-label={state === 'paused' ? 'Resume' : 'Pause'} title={state === 'paused' ? 'Resume recording' : 'Pause recording'} disabled={!capturing} onClick={onPause}>{state === 'paused' ? <Play size={17} weight="fill" /> : <Pause size={17} weight="fill" />}</button></>}
        <button className="meeting-hud-control meeting-hud-end" aria-label={state === 'starting' ? 'Cancel preparation' : 'End'} title={state === 'starting' ? 'Cancel preparation' : 'End and save meeting'} disabled={state === 'saving'} onClick={onEnd}><Stop size={13} weight="fill" /></button>
      </div>
    </div>
    {/* Present while empty, so that a toast appearing in it is announced. */}
    <div aria-live="polite" aria-atomic="true">{cueToast && <CueToastCard toast={cueToast} titles={cueMeetingTitles} onShow={() => onToggleCaptions(true)} onDismiss={onDismissCueToast} onHold={onHoldCueToast} />}</div></>}
    {state === 'starting' && <div className="meeting-hud-preparation"><ol aria-label="Preparation steps">{PREPARATION_STEPS.map((label, index) => <li key={label} data-state={prep > index ? 'done' : prep === index ? 'active' : 'todo'}>
      <span className="meeting-hud-step-mark" aria-hidden="true">{prep > index ? <Check size={9} weight="bold" /> : prep === index ? <SpinnerGap className="mui-spin" size={12} /> : null}</span>{index === 0 && sourceKind === 'replay' ? 'Audio file' : label}</li>)}</ol>
      <p role="status">{micWait ? 'Waiting for microphone permission…' : 'Recording starts when everything is ready.'}</p></div>}
    {error && <p role="alert" className="meeting-hud-error">{error}</p>}
  </main>
}
