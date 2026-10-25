// WebAudio 程序化音效 + 8-bit 搏击操 BGM
class AudioSys {
  constructor() { this.ctx = null; this.master = null; this.bgmTimer = null; this.bgmStep = 0; this.tempoScale = 1; }
  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  blip(freq, dur, type = 'square', vol = 0.3, slide = 0) {
    this.ensure();
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur);
  }
  noise(dur, vol = 0.3, freq = 1000) {
    this.ensure();
    const t = this.ctx.currentTime;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  }
  shoot() { this.noise(0.12, 0.35, 1800); this.blip(220, 0.08, 'square', 0.15, -150); }
  hit() { this.blip(1200, 0.06, 'sine', 0.25); }
  kill() { this.blip(523, 0.1, 'square', 0.3); setTimeout(() => this.blip(784, 0.15, 'square', 0.3), 90); }
  skill() { this.blip(300, 0.3, 'sawtooth', 0.2, 400); }
  hurt() { this.blip(150, 0.15, 'sawtooth', 0.25, -60); }
  beep() { this.blip(880, 0.08, 'sine', 0.2); }
  explode() { this.noise(1.2, 0.8, 400); this.blip(80, 1.0, 'sawtooth', 0.4, -50); }
  win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.2, 'square', 0.3), i * 130)); }
  lose() { [392, 330, 262].forEach((f, i) => setTimeout(() => this.blip(f, 0.25, 'square', 0.25), i * 160)); }
  click() { this.blip(600, 0.05, 'sine', 0.15); }
  // 8-bit 搏击操 BGM（下包后播放，随倒计时加速）
  startBGM() {
    if (this.bgmTimer) return;
    this.ensure();
    this.bgmStep = 0;
    const bass = [130.8, 130.8, 164.8, 130.8, 196, 164.8, 146.8, 196];
    const lead = [523, 659, 784, 659, 523, 587, 659, 880];
    const step = () => {
      const i = this.bgmStep % 8;
      this.blip(bass[i], 0.18, 'square', 0.16);
      this.blip(lead[i], 0.15, 'square', 0.1);
      this.bgmStep++;
      this.bgmTimer = setTimeout(step, 260 / this.tempoScale);
    };
    step();
  }
  setTempo(s) { this.tempoScale = s; }
  stopBGM() { if (this.bgmTimer) { clearTimeout(this.bgmTimer); this.bgmTimer = null; } }
}
export const AUDIO = new AudioSys();
