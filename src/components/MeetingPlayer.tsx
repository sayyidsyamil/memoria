import { useImperativeHandle, useRef, useState, type Ref } from 'react'
import { ArrowSquareOut, Flag, Pause, Play } from '@phosphor-icons/react'
import { clock } from '../lib/speakers'
import { Button } from './ui/button'
import './meetingPlayer.css'

export interface PlayerHandle { seek: (at: number, play?: boolean) => void }
export interface PlayerMark { at: number; label: string }

/** Recording player. The audio element always stays mounted so any tab can jump to a moment; it loads once `src` is known. */
export function MeetingPlayer({ src, fallbackDuration, marks, showControls, onTime, onMark, onOpenAudio, ref }: {
  src?: string; fallbackDuration: number; marks: PlayerMark[]; showControls: boolean
  onTime: (time: number, playing: boolean) => void; onMark?: () => void; onOpenAudio?: () => void; ref?: Ref<PlayerHandle>
}) {
  const audio = useRef<HTMLAudioElement>(null)
  const [time, setTime] = useState(0)
  const [length, setLength] = useState(fallbackDuration)
  const [playing, setPlaying] = useState(false)
  useImperativeHandle(ref, () => ({
    seek(at, play = true) {
      const element = audio.current
      if (!element) return
      element.currentTime = at
      setTime(at); onTime(at, !element.paused)
      if (play) void Promise.resolve(element.play()).catch(() => undefined)
    },
  }))
  const total = Math.max(length, fallbackDuration, time, 1)
  const progress = Math.min(100, Math.max(0, time / total * 100))
  const report = (element: HTMLAudioElement) => { setTime(element.currentTime); onTime(element.currentTime, !element.paused) }
  return <>
    <audio ref={audio} src={src} preload="metadata" aria-label="Meeting recording"
      onLoadedMetadata={event => { if (Number.isFinite(event.currentTarget.duration)) setLength(event.currentTarget.duration) }}
      onDurationChange={event => { if (Number.isFinite(event.currentTarget.duration)) setLength(event.currentTarget.duration) }}
      onTimeUpdate={event => report(event.currentTarget)}
      onPlay={event => { setPlaying(true); report(event.currentTarget) }}
      onPause={event => { setPlaying(false); report(event.currentTarget) }}
      onEnded={() => setPlaying(false)} />
    {showControls && <div className="player" role="group" aria-label="Recording player">
      <button type="button" className="player-toggle" aria-label={playing ? 'Pause recording' : 'Play recording'} onClick={() => {
        const element = audio.current
        if (!element) return
        if (element.paused) void Promise.resolve(element.play()).catch(() => undefined); else element.pause()
      }}>{playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}</button>
      <span className="player-time" aria-label="Elapsed time">{clock(time)}</span>
      <div className="player-track" style={{ ['--progress' as string]: `${progress}%` }}>
        <input type="range" aria-label="Seek recording" min={0} max={total} step={0.1} value={Math.min(time, total)}
          onChange={event => { const element = audio.current; const next = Number(event.target.value); if (element) element.currentTime = next; setTime(next); onTime(next, playing) }} />
        {marks.map((mark, index) => <span key={`${mark.at}-${index}`} className="player-mark" title={`${clock(mark.at)} ${mark.label || 'Marked moment'}`} style={{ left: `${Math.min(100, mark.at / total * 100)}%` }} />)}
      </div>
      <span className="player-time" aria-label="Total length">{clock(total)}</span>
      {onMark && <Button variant="ghost" size="icon-sm" aria-label="Mark this moment" title="Mark this moment" onClick={onMark}><Flag size={15} /></Button>}
      {onOpenAudio && <Button variant="ghost" size="icon-sm" aria-label="Open audio in the default player" title="Open audio in the default player" onClick={onOpenAudio}><ArrowSquareOut size={15} /></Button>}
    </div>}
  </>
}
