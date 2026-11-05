import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import source from './meetingPcm.worklet.js?raw'

type Sent = Float32Array | { flushed: boolean; command?: string }
type Port = { onmessage: (event: { data: unknown }) => void; postMessage: (value: Sent) => void }
type Processor = { port: Port; process: (input: Float32Array[][], output: Float32Array[][]) => boolean }

function processor(name = 'meeting-pcm') {
  const sent: Sent[] = []
  const processors = new Map<string, new () => Processor>()
  runInNewContext(source, {
    Float32Array,
    AudioWorkletProcessor: class { port: Port = { onmessage: () => undefined, postMessage: value => { sent.push(value) } } },
    registerProcessor: (registered: string, value: new () => Processor) => { processors.set(registered, value) },
  })
  const instance = new (processors.get(name)!)()
  return {
    sent,
    command: (data: unknown) => instance.port.onmessage({ data }),
    feed: (values: number[]) => instance.process([[new Float32Array(values)]], [[new Float32Array(values.length)]]),
    /** One 128-sample render quantum of output. */
    play: () => { const output = new Float32Array(128); instance.process([], [[output]]); return Array.from(output) },
  }
}

const ramp = (start: number, length: number) => new Float32Array(Array.from({ length }, (_, index) => start + index))

it('pause flushes accepted partial PCM and excludes audio supplied while paused', () => {
  const pcm = processor()
  pcm.feed([1, 2, 3])
  pcm.command('pause')
  pcm.feed([9, 9])
  pcm.command('resume')
  pcm.feed([4, 5])
  pcm.command('stop')
  expect(pcm.sent.filter(value => value instanceof Float32Array).map(value => Array.from(value as Float32Array))).toEqual([[1, 2, 3], [4, 5]])
})

it('stop is a fence: no further audio can enter the final drain', () => {
  const pcm = processor()
  pcm.feed([1, 2])
  pcm.command('stop')
  pcm.feed([3, 4])
  pcm.command('stop')
  expect(pcm.sent.filter(value => value instanceof Float32Array).map(value => Array.from(value as Float32Array))).toEqual([[1, 2]])
})

it('call audio stays silent until more than 0.1 s is buffered, then plays it in order', () => {
  const call = processor('meeting-call-audio')
  expect(call.play().every(sample => sample === 0)).toBe(true)
  call.command(ramp(1, 1600))
  expect(call.play().every(sample => sample === 0)).toBe(true)
  call.command(ramp(1601, 1600))
  expect(call.play()).toEqual(Array.from(ramp(1, 128)))
  expect(call.play()).toEqual(Array.from(ramp(129, 128)))
})

it('call audio plays zeros when its buffer runs dry, then waits to refill', () => {
  const call = processor('meeting-call-audio')
  call.command(ramp(1, 1700))
  for (let quantum = 0; quantum < 13; quantum++) call.play()
  const last = call.play()
  expect(last.slice(0, 36)).toEqual(Array.from(ramp(1665, 36)))
  expect(last.slice(36).every(sample => sample === 0)).toBe(true)
  call.command(ramp(5000, 1600))
  expect(call.play().every(sample => sample === 0)).toBe(true)
  call.command(ramp(6600, 1600))
  expect(call.play()[0]).toBe(5000)
})

it('call audio drops the oldest audio beyond 0.5 s, so the delay stays bounded', () => {
  const call = processor('meeting-call-audio')
  for (let frame = 0; frame < 10; frame++) call.command(ramp(frame * 1600 + 1, 1600))
  expect(call.play()[0]).toBe(16000 - 8000 + 1)
  let played = 128
  while (call.play().some(sample => sample !== 0)) played += 128
  expect(played).toBe(8064)
})

it('clearing call audio empties its buffer', () => {
  const call = processor('meeting-call-audio')
  call.command(ramp(1, 3200))
  call.command('clear')
  expect(call.play().every(sample => sample === 0)).toBe(true)
  call.command(ramp(1, 1600))
  expect(call.play().every(sample => sample === 0)).toBe(true)
})
