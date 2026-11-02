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
