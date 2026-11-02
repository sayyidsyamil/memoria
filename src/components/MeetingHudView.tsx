import type { ReactNode, Ref, UIEvent } from 'react'
import { ArrowsOutSimple, CaretUp, Check, Flag, Microphone, Pause, Play, SpinnerGap, Stop, WarningCircle } from '@phosphor-icons/react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { TranscriptDraft } from './MeetingTranscriptReview'
import { speakerLabel, speakerOrder, speakerTone } from '../lib/speakers'
import { COMPACT_BARS, PREPARATION_STEPS, clockText } from '../lib/hud'
import { Avatar, LevelMeter } from './memoriaUi'
import './meetingHud.css'
import type { LiveCue } from '../features/temporal/liveAssistanceService'
import { attributeLabel, formatValue, labelUnit, meetingLabel, type MeetingTitles } from '../features/temporal/temporalFormat'
import { LiveAskPanel } from '../features/temporal/LiveAskPanel'

export type HudState = 'starting' | 'recording' | 'paused' | 'saving' | 'error'
export interface HudViewProps {
  sourceKind?: 'microphone' | 'replay'; replayNotice?: string; progressText?: string
  vaultPath?: string
  assistanceEnabled?: boolean; onToggleAssistance?: (enabled: boolean) => void; liveCues?: LiveCue[]; assistanceNotice?: string; cueMeetingTitles?: MeetingTitles
  state: HudState; saveStage: string; seconds: number; levels: number[]; prep: number; captionsOpen: boolean
  liveTurns: TranscriptDraft['segments']; caption: string; captionError: string; marks: { at: number; label: string }[]; markNotice: string; error: string; micWait?: boolean
  transcriptRef?: Ref<HTMLDivElement>; onTranscriptScroll?: (event: UIEvent<HTMLDivElement>) => void
  onToggleCaptions: (open: boolean) => void; onOpenWorkspace: () => void; onPause: () => void; onEnd: () => void; onMark: () => void
}

const PLAIN_ATTRIBUTES = new Set(['outcome', 'value', 'amount', 'date'])

/** A statement just made contradicts an approved value: show that value, the words that set it, and who said them when. */
function LiveCueCard({ cue, titles }: { cue: LiveCue; titles?: MeetingTitles }): ReactNode {
  const holdsNumber = typeof cue.currentValue === 'number'
  const { title, unit } = labelUnit(cue.label, holdsNumber)
  const name = PLAIN_ATTRIBUTES.has(cue.attribute.toLowerCase()) ? title : `${title} ${attributeLabel(cue.attribute).toLowerCase()}`
  const value = formatValue(cue.currentValue as Parameters<typeof formatValue>[0], holdsNumber ? 'number' : undefined, unit)
  const source = [cue.speaker || 'Unknown speaker', meetingLabel(cue.meeting, titles ?? new Map()), typeof cue.at === 'number' ? clockText(Math.floor(cue.at)) : null]
  return <article className="meeting-hud-cue">
    <p className="meeting-hud-cue-kicker"><WarningCircle size={14} weight="fill" aria-hidden="true" />Earlier decision</p>
    <p className="meeting-hud-cue-value">{name} is <strong>{value}</strong></p>
    <blockquote>“{cue.quote}”</blockquote>
    <small>{source.filter(Boolean).join(' · ')}</small>
    <details><summary>Why this was flagged</summary><p>{cue.reason}</p></details>
  </article>
}

/** Presentation only: the notch, its preparation steps and the expanded Record view. */
export function MeetingHudView({ state, saveStage, seconds, levels, prep, captionsOpen, liveTurns, caption, captionError, marks, markNotice, error, micWait,
  assistanceEnabled, onToggleAssistance, liveCues, assistanceNotice, cueMeetingTitles, vaultPath, sourceKind, replayNotice, progressText,
  transcriptRef, onTranscriptScroll, onToggleCaptions, onOpenWorkspace, onPause, onEnd, onMark }: HudViewProps): ReactNode {
  const liveOrder = speakerOrder(liveTurns.map(turn => turn.speaker))
  const statusText = state === 'starting' ? 'Preparing' : state === 'recording' ? 'Recording' : state === 'paused' ? 'Paused' : state === 'saving' ? saveStage : 'Needs attention'
  const capturing = state === 'recording' || state === 'paused'
  const transcript = <div ref={transcriptRef} className="meeting-hud-transcript" aria-label="Live transcript" aria-live="polite" onScroll={onTranscriptScroll}>{liveTurns.length ? liveTurns.map((turn, index) => <div className="meeting-hud-live-turn" key={`${turn.start}-${index}`} data-latest={index === liveTurns.length - 1 || undefined} data-tone={speakerTone(turn.speaker, liveOrder)}>
    <Avatar label={speakerLabel(turn.speaker, undefined, liveOrder)} tone={speakerTone(turn.speaker, liveOrder)} size={28} /><p><span className="sr-only">{speakerLabel(turn.speaker, undefined, liveOrder)}: </span>{turn.text}</p></div>)
    : <p className="meeting-hud-empty">{caption || (state === 'saving' ? 'Finishing the remaining audio…' : captionError ? 'No live transcript available.' : 'Listening for speech…')}</p>}</div>
  return <main className="meeting-hud" data-state={state} data-open={captionsOpen || undefined}>
    {captionsOpen ? <>
      <div className="meeting-hud-bar" onMouseDown={event => { if (event.button === 0 && !(event.target as HTMLElement).closest('button')) void getCurrentWindow().startDragging() }}>
        <span className="meeting-hud-bar-title"><Microphone size={15} aria-hidden="true" />Memoria</span>
        <div className="meeting-hud-controls">
          <button className="meeting-hud-control" aria-label="Open workspace" title="Open workspace" onClick={onOpenWorkspace}><ArrowsOutSimple size={17} /></button>
          <button className="meeting-hud-captions-toggle" aria-label="Toggle live captions" aria-expanded={captionsOpen} title="Collapse to the notch" onClick={() => onToggleCaptions(false)}><CaretUp size={15} /></button>
        </div>
      </div>
      <section className="meeting-hud-record" aria-label="Recording">
        <span className="meeting-hud-pill" role="status"><i />{statusText}</span>
        <div className="meeting-hud-bigtime" aria-label="Meeting duration">{clockText(seconds)}</div>
        <LevelMeter className="meeting-hud-wave" levels={levels} paused={state === 'paused'} />
        {sourceKind === 'replay' && <p className="meeting-hud-hint">Prerecorded audio test · no microphone capture</p>}
        {replayNotice && <p role="status" className="meeting-hud-hint">{replayNotice}</p>}
        {progressText && <p role="status" className="meeting-hud-hint" aria-label="Caption audio progress">{progressText}</p>}
        {onToggleAssistance && <label className="meeting-hud-assistance-toggle"><input type="checkbox" checked={!!assistanceEnabled} onChange={event => onToggleAssistance(event.target.checked)} />Check against approved tracked facts</label>}
        {assistanceNotice && <p className="meeting-hud-caption-warning" role="status">{assistanceNotice}</p>}
        {!!liveCues?.length && <section className="meeting-hud-evidence" aria-label="Earlier decisions to check" aria-live="polite">{liveCues.map(cue => <LiveCueCard key={`${cue.factId}:${cue.reason}`} cue={cue} titles={cueMeetingTitles} />)}</section>}
        {captionError && <p role="alert" className="meeting-hud-caption-warning">Live transcript paused. Your recording is preserved.</p>}
        {transcript}
        {vaultPath && <LiveAskPanel vaultPath={vaultPath} sessionText={caption} enabled={capturing} />}
        <small className="meeting-hud-hint">{captionError ? <details><summary>Show details</summary>{captionError}</details> : 'Speaker labels are provisional. Add names in review.'}</small>
      </section>
      <footer className="meeting-hud-actions">
        <button className="meeting-hud-mark" disabled={!capturing} onClick={onMark}><Flag size={15} />Mark moment<kbd>M</kbd></button>
        <span className="meeting-hud-marked" role="status">{markNotice || (marks.length ? `${marks.length} marked` : '')}</span>
        <button className="meeting-hud-pause" disabled={!capturing} onClick={onPause}>{state === 'paused' ? <Play size={15} weight="fill" /> : <Pause size={15} weight="fill" />}{state === 'paused' ? 'Resume' : 'Pause'}</button>
        <button className="meeting-hud-stop" disabled={state === 'saving'} onClick={onEnd}><Stop size={13} weight="fill" />End meeting</button>
      </footer>
    </> : <div className="meeting-hud-row">
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
        {state !== 'starting' && <><button className="meeting-hud-control" aria-label="Open workspace" title="Open workspace" onClick={onOpenWorkspace}><ArrowsOutSimple size={17} /></button>
        <button className="meeting-hud-control" aria-label={state === 'paused' ? 'Resume' : 'Pause'} title={state === 'paused' ? 'Resume recording' : 'Pause recording'} disabled={!capturing} onClick={onPause}>{state === 'paused' ? <Play size={17} weight="fill" /> : <Pause size={17} weight="fill" />}</button></>}
        <button className="meeting-hud-control meeting-hud-end" aria-label={state === 'starting' ? 'Cancel preparation' : 'End'} title={state === 'starting' ? 'Cancel preparation' : 'End and save meeting'} disabled={state === 'saving'} onClick={onEnd}><Stop size={13} weight="fill" /></button>
      </div>
    </div>}
    {state === 'starting' && <div className="meeting-hud-preparation"><ol aria-label="Preparation steps">{PREPARATION_STEPS.map((label, index) => <li key={label} data-state={prep > index ? 'done' : prep === index ? 'active' : 'todo'}>
      <span className="meeting-hud-step-mark" aria-hidden="true">{prep > index ? <Check size={9} weight="bold" /> : prep === index ? <SpinnerGap className="mui-spin" size={12} /> : null}</span>{index === 0 && sourceKind === 'replay' ? 'Audio file' : label}</li>)}</ol>
      <p role="status">{micWait ? 'Waiting for microphone permission…' : 'Recording starts when everything is ready.'}</p></div>}
    {error && <p role="alert" className="meeting-hud-error">{error}</p>}
  </main>
}
