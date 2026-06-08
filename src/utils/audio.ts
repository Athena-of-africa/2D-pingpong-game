/**
 * Retro synth sounds for our Ping Pong game using Web Audio API.
 * Designed to prevent blocking by browsers by lazy-initializing on user interaction.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Play a sound with safe error handling and volume controls.
 */
function playTone(freq: number, duration: number, type: OscillatorType = "sine", gainEnd = 0.001) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    gainNode.gain.setValueAtTime(0.12, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(gainEnd, ctx.currentTime + duration);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    // Gracefully ignore audio context failures (e.g. user gestures block)
    console.warn("Audio playback blocked or failed:", e);
  }
}

export const playPaddleHitSound = () => {
  playTone(330, 0.09, "triangle"); // E4 short chime
};

export const playWallHitSound = () => {
  playTone(220, 0.08, "triangle"); // A3 classic retro bump
};

export const playScoreSound = () => {
  // Simple arcade double-pulse chime
  playTone(440, 0.1, "sine");
  setTimeout(() => {
    playTone(554.37, 0.15, "sine"); // C#5 celebratory beep
  }, 100);
};

export const playGameOverWinSound = () => {
  const notes = [261.63, 329.63, 392.00, 523.25]; // C M7 arpeggio
  notes.forEach((freq, i) => {
    setTimeout(() => {
      playTone(freq, 0.25, "sine");
    }, i * 150);
  });
};

export const playGameOverLoseSound = () => {
  const notes = [311.13, 293.66, 277.18, 220.00]; // Diminishing notes
  notes.forEach((freq, i) => {
    setTimeout(() => {
      playTone(freq, 0.3, "sawtooth", 0.002);
    }, i * 180);
  });
};

export const playMenuClickSound = () => {
  playTone(523.25, 0.05, "sine"); // Tiny clear synth blip
};
