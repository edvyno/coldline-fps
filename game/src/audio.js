// Audio: every sound is synthesised with WebAudio at run time, so the game ships no audio file and
// nothing is fetched. One context, a noise buffer built once, and short envelopes; a sound played
// twice never makes garbage because each voice stops itself.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noise = null;
  let muted = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    // one second of white noise, reused by every shot
    const frames = Math.floor(ctx.sampleRate * 1.0);
    noise = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function env(node, peak, attack, decay) {
    const now = ctx.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setValueAtTime(0.0001, now);
    node.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), now + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
  }

  function burst(duration, filterHz, peak, q) {
    if (!ctx || muted) return;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterHz;
    filter.Q.value = q ?? 1;
    const gain = ctx.createGain();
    env(gain, peak, 0.004, duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start();
    source.stop(ctx.currentTime + duration + 0.05);
  }

  function tone(frequency, duration, peak, type) {
    if (!ctx || muted) return;
    const osc = ctx.createOscillator();
    osc.type = type ?? 'sine';
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    const gain = ctx.createGain();
    env(gain, peak, 0.006, duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.05);
  }

  return {
    ensure,
    get muted() {
      return muted;
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    // The player's rifle: a body of noise, a low thump, and a tail that says how big the room is.
    shot(kind) {
      if (!ctx) return;
      const heavy = kind === 'rifle';
      burst(heavy ? 0.16 : 0.11, heavy ? 2100 : 2800, 0.85, 0.8);
      tone(heavy ? 118 : 165, 0.13, 0.5, 'triangle');
      burst(0.4, 620, 0.16, 0.4);
    },
    // A bot's shot from a distance: duller, quieter, and offset so it reads as another source.
    distantShot(distance) {
      if (!ctx) return;
      const falloff = Math.max(0.06, 1 - distance / 46);
      burst(0.12, 1300, 0.3 * falloff, 0.7);
      tone(96, 0.1, 0.16 * falloff, 'triangle');
    },
    dryFire() {
      if (!ctx) return;
      burst(0.04, 5200, 0.22, 2);
    },
    reload() {
      if (!ctx) return;
      burst(0.05, 3600, 0.2, 3);
      window.setTimeout(() => burst(0.05, 2400, 0.18, 3), 160);
    },
    hit(headshot) {
      if (!ctx) return;
      tone(headshot ? 1720 : 1280, 0.06, 0.22, 'square');
    },
    hurt() {
      if (!ctx) return;
      burst(0.18, 480, 0.34, 0.6);
      tone(74, 0.2, 0.22, 'sine');
    },
    step() {
      if (!ctx) return;
      burst(0.06, 900, 0.09, 1.4);
    },
    beep(urgent) {
      if (!ctx) return;
      tone(urgent ? 1720 : 1180, 0.05, 0.16, 'square');
    },
    plant() {
      if (!ctx) return;
      tone(420, 0.12, 0.2, 'sawtooth');
      window.setTimeout(() => tone(620, 0.16, 0.2, 'sawtooth'), 130);
    },
    defuse() {
      if (!ctx) return;
      tone(880, 0.08, 0.14, 'sine');
    },
    explosion() {
      if (!ctx) return;
      burst(1.1, 320, 1.0, 0.4);
      tone(52, 0.9, 0.6, 'sine');
      burst(0.5, 1600, 0.3, 0.3);
    },
    grenadeBounce() {
      if (!ctx) return;
      burst(0.05, 1700, 0.14, 2.4);
    },
    buy() {
      if (!ctx) return;
      tone(1046, 0.07, 0.14, 'sine');
      window.setTimeout(() => tone(1568, 0.09, 0.12, 'sine'), 70);
    },
    roundWin() {
      if (!ctx) return;
      tone(523, 0.14, 0.18, 'triangle');
      window.setTimeout(() => tone(784, 0.2, 0.16, 'triangle'), 120);
    },
    roundLoss() {
      if (!ctx) return;
      tone(392, 0.18, 0.16, 'triangle');
      window.setTimeout(() => tone(262, 0.26, 0.16, 'triangle'), 140);
    },
  };
}
