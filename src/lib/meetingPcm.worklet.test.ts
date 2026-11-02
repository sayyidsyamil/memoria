import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import source from './meetingPcm.worklet.js?raw'

function processor() {
  const sent: (Float32Array | { flushed: boolean; command?: string })[] = []
  const port: { onmessage: (event: { data: string }) => void; postMessage: (value: typeof sent[number]) => void } = {
    onmessage: () => undefined, postMessage: value => { sent.push(value) },
  }
  let Processor!: new () => { port: typeof port; process: (input: Float32Array[][], output: Float32Array[][]) => boolean }
  runInNewContext(source, {
    Float32Array,
    AudioWorkletProcessor: class { port = port },
    registerProcessor: (_name: string, value: typeof Processor) => { Processor = value },
  })
  const instance = new Processor()
  return {
    sent,
    command: (data: string) => instance.port.onmessage({ data }),
    feed: (values: number[]) => instance.process([[new Float32Array(values)]], [[new Float32Array(values.length)]]),
  }
}

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
