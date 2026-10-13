// Tiny synthesized sounds for Catio Prowl (no audio files): a meow, a crash, a chirp, a purr, a chime and a
// thud. Web Audio starts on the first user gesture; everything is quiet and can be muted.
type Sound = 'meow' | 'crash' | 'chirp' | 'purr' | 'ding' | 'thud';

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

function tone(a: AudioContext, type: OscillatorType, f0: number, f1: number, t0: number, dur: number, vol: number) {
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.05, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(a: AudioContext, t0: number, dur: number, vol: number, freq: number) {
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf;
  f.type = 'bandpass';
  f.frequency.value = freq;
  g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t0);
}

export function play(s: Sound) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.01;
  switch (s) {
    case 'meow':
      tone(a, 'sawtooth', 520, 820, t, 0.18, 0.05);
      tone(a, 'sawtooth', 820, 430, t + 0.17, 0.32, 0.05);
      tone(a, 'sine', 1040, 860, t, 0.48, 0.03);
      break;
    case 'crash': noise(a, t, 0.35, 0.5, 2400); noise(a, t + 0.05, 0.2, 0.3, 5200); break;
    case 'chirp': tone(a, 'sine', 2600, 3600, t, 0.08, 0.04); tone(a, 'sine', 2900, 4000, t + 0.12, 0.08, 0.04); break;
    case 'purr': for (let i = 0; i < 6; i++) tone(a, 'triangle', 48, 44, t + i * 0.2, 0.18, 0.06); break;
    case 'ding': tone(a, 'sine', 880, 880, t, 0.25, 0.05); tone(a, 'sine', 1320, 1320, t + 0.09, 0.3, 0.04); break;
    case 'thud': tone(a, 'sine', 120, 60, t, 0.15, 0.12); break;
  }
}
