// Dedicated 16 kHz PCM tap. Recording storage remains owned by MediaRecorder.
class MeetingPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.buffer = new Float32Array(4096); this.offset = 0
    this.port.onmessage = () => {
      if (this.offset) this.port.postMessage(this.buffer.slice(0, this.offset))
      this.offset = 0; this.port.postMessage({ flushed: true })
    }
  }
  process(inputs) {
    const channel = inputs[0]?.[0]
    if (!channel) return true
    for (const sample of channel) {
      this.buffer[this.offset++] = sample
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer)
        this.buffer = new Float32Array(4096); this.offset = 0
      }
    }
    return true
  }
}
registerProcessor('meeting-pcm', MeetingPcmProcessor)
