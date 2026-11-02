// Dedicated 16 kHz PCM tap. Recording storage remains owned by MediaRecorder.
class MeetingPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.buffer = new Float32Array(4096); this.offset = 0
    this.paused = false; this.ended = false; this.totalSamples = 0
    this.port.onmessage = event => {
      const command = event.data
      if (command === 'pause') this.paused = true
      if (command === 'stop') this.ended = true
      if (command === 'resume' && !this.ended) this.paused = false
      if (command !== 'resume' && this.offset) {
        const tail = this.buffer.slice(0, this.offset)
        this.port.postMessage(tail, [tail.buffer])
        this.buffer = new Float32Array(4096); this.offset = 0
      }
      this.port.postMessage({ flushed: true, command, totalSamples: this.totalSamples })
    }
  }
  process(inputs, outputs) {
    const channel = inputs[0]?.[0]
    const output = outputs?.[0]?.[0]
    if (!channel || this.paused || this.ended) {
      output?.fill(0)
      return true
    }
    output?.set(channel)
    this.totalSamples += channel.length
    for (const sample of channel) {
      this.buffer[this.offset++] = sample
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer, [this.buffer.buffer])
        this.buffer = new Float32Array(4096); this.offset = 0
      }
    }
    return true
  }
}
registerProcessor('meeting-pcm', MeetingPcmProcessor)

const CALL_RATE = 16000
/** Playback starts once more than 0.1 s is buffered (two of the helper's 100 ms frames), so a late frame leaves no gap. */
const CALL_START = CALL_RATE / 10
/** More than this from uneven arrival or clock drift and the oldest audio goes, so the delay stays bounded. */
const CALL_MAX = CALL_RATE / 2

// Audio playing on this Mac, posted as 16 kHz frames from the call audio helper, played into the meeting graph. A dry
// buffer plays zeros and waits to refill; 'clear' empties it.
class MeetingCallAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.ring = new Float32Array(CALL_MAX * 2); this.read = 0; this.size = 0; this.playing = false
    this.port.onmessage = event => {
      if (event.data === 'clear') { this.read = 0; this.size = 0; this.playing = false }
      else if (event.data instanceof Float32Array) this.push(event.data)
    }
  }
  push(samples) {
    const ring = this.ring
    for (let index = Math.max(0, samples.length - CALL_MAX); index < samples.length; index++) ring[(this.read + this.size++) % ring.length] = samples[index]
    if (this.size > CALL_MAX) { this.read = (this.read + this.size - CALL_MAX) % ring.length; this.size = CALL_MAX }
  }
  process(_inputs, outputs) {
    const output = outputs?.[0]?.[0]
    if (!output) return true
    if (!this.playing && this.size > CALL_START) this.playing = true
    const count = this.playing ? Math.min(output.length, this.size) : 0
    for (let index = 0; index < count; index++) output[index] = this.ring[(this.read + index) % this.ring.length]
    this.read = (this.read + count) % this.ring.length; this.size -= count
    if (this.playing && !this.size) this.playing = false
    output.fill(0, count)
    return true
  }
}
registerProcessor('meeting-call-audio', MeetingCallAudioProcessor)
