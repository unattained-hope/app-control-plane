/**
 * Web Audio API & HTML5 Audio synthesizer for chat sounds (call ringer and message chime).
 * 
 * Synthesizes audio natively with zero external dependencies, zero network requests,
 * and zero asset loading failure risks.
 */

let sharedAudioCtx: AudioContext | null = null;
let activeRingerCleanup: (() => void) | null = null;
let isUnlocked = false;
let soundEnabled = true;

// Load saved sound preference
if (typeof window !== "undefined") {
  try {
    const saved = localStorage.getItem("apoaap_chat_sound_enabled");
    if (saved !== null) {
      soundEnabled = saved === "true";
    }
  } catch {
    // ignore
  }
}

/** Check if sound is enabled. */
export function isSoundEnabled(): boolean {
  return soundEnabled;
}

/** Toggle or set sound enabled state. */
export function setSoundEnabled(enabled: boolean): void {
  soundEnabled = enabled;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem("apoaap_chat_sound_enabled", String(enabled));
    } catch {
      // ignore
    }
  }
  if (!enabled) {
    stopCallRinger();
  }
}

/** Get or initialize the shared AudioContext. */
export function getAudioContext(): AudioContext | null {
  const g = (typeof window !== "undefined"
    ? window
    : globalThis) as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  if (!g) return null;

  if (!sharedAudioCtx) {
    const AudioCtxClass = g.AudioContext || g.webkitAudioContext;
    if (AudioCtxClass) {
      try {
        sharedAudioCtx = new AudioCtxClass();
      } catch {
        // ignore
      }
    }
  }

  if (sharedAudioCtx && sharedAudioCtx.state === "suspended") {
    void sharedAudioCtx.resume().catch(() => {});
  }

  return sharedAudioCtx;
}

/** Explicitly resume / unlock AudioContext on user interaction. */
export async function unlockAudio(): Promise<boolean> {
  const ctx = getAudioContext();
  if (!ctx) return false;
  try {
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    isUnlocked = true;
    return true;
  } catch {
    return false;
  }
}

/** Auto-resume AudioContext on first user interaction in the page. */
export function initAudioUnlock(): void {
  if (typeof window === "undefined" || isUnlocked) return;

  const unlock = () => {
    void unlockAudio();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
    window.removeEventListener("click", unlock);
    window.removeEventListener("touchstart", unlock);
  };

  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock, { passive: true });
  window.addEventListener("click", unlock, { passive: true });
  window.addEventListener("touchstart", unlock, { passive: true });
}

/** Generate a self-contained Base64 WAV data URI for a dual-tone chime. */
function generateChimeWavDataUri(): string {
  const sampleRate = 22050;
  const duration = 0.45;
  const numSamples = Math.floor(sampleRate * duration);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  // WAV Header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, numSamples * 2, true);

  // Synthesize: Tone 1 (659Hz) -> Tone 2 (880Hz)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;
    if (t < 0.2) {
      const env = Math.max(0, 1 - t / 0.2);
      sample = Math.sin(2 * Math.PI * 659.25 * t) * env * 0.4;
    }
    if (t >= 0.08) {
      const t2 = t - 0.08;
      const env2 = Math.max(0, 1 - t2 / 0.35);
      sample += Math.sin(2 * Math.PI * 880 * t2) * env2 * 0.5;
    }
    const s = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return "data:audio/wav;base64," + btoa(binary);
}

let cachedChimeDataUri: string | null = null;

/**
 * Play a crisp two-tone message notification chime.
 */
export function playNotificationSound(): void {
  if (!soundEnabled) return;

  const ctx = getAudioContext();
  let webAudioSucceeded = false;

  if (ctx) {
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }

    try {
      const now = ctx.currentTime;

      // First tone (E5: ~659.25Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(659.25, now);
      gain1.gain.setValueAtTime(0.25, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.2);

      // Second tone (A5: 880.00Hz)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(880.0, now + 0.08);
      gain2.gain.setValueAtTime(0.3, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.5);

      webAudioSucceeded = true;
    } catch {
      webAudioSucceeded = false;
    }
  }

  // Fallback to HTML5 Audio if Web Audio context is not active
  if (!webAudioSucceeded && typeof window !== "undefined" && typeof Audio !== "undefined") {
    try {
      if (!cachedChimeDataUri) {
        cachedChimeDataUri = generateChimeWavDataUri();
      }
      const audio = new Audio(cachedChimeDataUri);
      audio.volume = 0.5;
      void audio.play().catch(() => {});
    } catch {
      // Audio playback best effort
    }
  }
}

/**
 * Start playing a continuous phone call ringer (repeating ring pulses).
 * Automatically stops after durationSec (default 30 seconds) or when stopCallRinger() is called.
 */
export function startCallRinger(options?: {
  readonly durationSec?: number;
  readonly onStop?: () => void;
}): () => void {
  // Stop any currently active ringer first
  stopCallRinger();

  if (!soundEnabled) {
    options?.onStop?.();
    return () => {};
  }

  const ctx = getAudioContext();
  const durationSec = options?.durationSec ?? 30;
  let isStopped = false;
  const timeoutIds: number[] = [];
  const activeNodes: Array<{ stop?: (time?: number) => void; disconnect?: () => void }> = [];

  const cleanup = () => {
    if (isStopped) return;
    isStopped = true;
    for (const id of timeoutIds) {
      clearTimeout(id);
    }
    timeoutIds.length = 0;
    for (const node of activeNodes) {
      try {
        node.stop?.();
        node.disconnect?.();
      } catch {
        // ignore
      }
    }
    activeNodes.length = 0;
    if (activeRingerCleanup === cleanup) {
      activeRingerCleanup = null;
    }
    options?.onStop?.();
  };

  activeRingerCleanup = cleanup;

  if (!ctx) {
    const endTimer = Number(setTimeout(cleanup, durationSec * 1000));
    timeoutIds.push(endTimer);
    return cleanup;
  }

  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => {});
  }

  function playRingBurst(startTimeOffset: number) {
    if (isStopped || !ctx) return;
    try {
      const now = ctx.currentTime + startTimeOffset;

      // Dual tone: 440 Hz + 480 Hz (Standard North American / International call ringer)
      const oscA = ctx.createOscillator();
      const oscB = ctx.createOscillator();
      const gain = ctx.createGain();

      oscA.type = "sine";
      oscA.frequency.setValueAtTime(440, now);

      oscB.type = "sine";
      oscB.frequency.setValueAtTime(480, now);

      // Amplitude envelope: 1.6s ring duration with smooth fade in / out
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.25, now + 0.08);
      gain.gain.setValueAtTime(0.25, now + 1.5);
      gain.gain.linearRampToValueAtTime(0.001, now + 1.65);

      oscA.connect(gain);
      oscB.connect(gain);
      gain.connect(ctx.destination);

      oscA.start(now);
      oscB.start(now);
      oscA.stop(now + 1.7);
      oscB.stop(now + 1.7);

      activeNodes.push(oscA, oscB, gain);
    } catch {
      // Audio playback best effort
    }
  }

  // Schedule bursts every 3 seconds (1.6s ring + 1.4s silence) for the full duration
  const ringCadenceSec = 3.0;
  const totalRings = Math.ceil(durationSec / ringCadenceSec);

  for (let i = 0; i < totalRings; i++) {
    const delayMs = i * ringCadenceSec * 1000;
    if (delayMs < durationSec * 1000) {
      const tId = Number(setTimeout(() => {
        if (!isStopped) playRingBurst(0);
      }, delayMs));
      timeoutIds.push(tId);
    }
  }

  // Auto-stop after durationSec
  const finalTimeout = Number(setTimeout(cleanup, durationSec * 1000));
  timeoutIds.push(finalTimeout);

  return cleanup;
}

/** Stop the currently active call ringer immediately. */
export function stopCallRinger(): void {
  if (activeRingerCleanup) {
    const cleanup = activeRingerCleanup;
    activeRingerCleanup = null;
    cleanup();
  }
}

/** Returns true if a call ringer is currently ringing. */
export function isRingerActive(): boolean {
  return activeRingerCleanup !== null;
}
