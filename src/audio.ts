export function createAudio() {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let whirr: { gain: GainNode; filter: BiquadFilterNode } | null = null
  let enabled = true

  function ensure() {
    if (ctx) return ctx
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = enabled ? 1 : 0
    master.connect(ctx.destination)
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const source = ctx.createBufferSource()
    source.buffer = noise
    source.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = "bandpass"
    filter.Q.value = 6
    const gain = ctx.createGain()
    gain.gain.value = 0
    source.connect(filter).connect(gain).connect(master)
    source.start()
    whirr = { gain, filter }
    return ctx
  }

  function clink(size: number, volume = 0.18) {
    if (!ctx || !master || !enabled) return
    const now = ctx.currentTime
    // Inharmonic partials, as a struck metal disc rings.
    for (const [ratio, level] of [
      [1, 1],
      [2.76, 0.5],
      [5.4, 0.3],
    ]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = (5200 / size) * ratio * (0.97 + Math.random() * 0.06)
      gain.gain.setValueAtTime(volume * level, now)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25 + 0.15 / ratio)
      osc.connect(gain).connect(master)
      osc.start(now)
      osc.stop(now + 0.5)
    }
  }

  function rattle(size: number) {
    ;[0, 70, 150].forEach((ms, i) => setTimeout(() => clink(size, 0.08 / (i + 1)), ms))
  }

  // One shared whirr: louder with more coins rolling, higher as they spin faster.
  function setWhirr(rolling: number, spin: number) {
    if (!ctx || !whirr) return
    const t = ctx.currentTime
    whirr.gain.gain.setTargetAtTime(rolling ? Math.min(0.09, 0.025 * Math.sqrt(rolling)) : 0, t, 0.08)
    whirr.filter.frequency.setTargetAtTime(220 + spin * 260, t, 0.08)
  }

  function setEnabled(on: boolean) {
    enabled = on
    if (master && ctx) master.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.05)
  }

  return { ensure, clink, rattle, setWhirr, setEnabled }
}
