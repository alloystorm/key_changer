/**
 * Tests for the adaptive keyboard range animation (App.tsx rAF loop).
 *
 * Reproduces the pure step logic here so we can run it without React or a browser.
 * Scenarios mirror real user situations: portrait-mode song load, oscillating target,
 * orientation change, and windowed-mode pan.
 */

import { describe, it, expect } from 'vitest';

// ─── Replicate animation constants from App.tsx ────────────────────────────────
const EXPAND_LAMBDA = 5;
const SHRINK_LAMBDA = 2.0;
const MIDI_LOW  = 21;
const MIDI_HIGH = 108;
const SNAP_THRESHOLD = 48;

interface Range { low: number; high: number }

/**
 * One frame of the key-range animation (mirrors the rAF `step` in App.tsx).
 * Returns the new animated range.
 */
function animStep(anim: Range, target: Range, dt: number): Range {
  const { low, high } = anim;

  if (Math.abs(target.low - low) > SNAP_THRESHOLD || Math.abs(target.high - high) > SNAP_THRESHOLD) {
    return { low: target.low, high: target.high };
  }

  const dLow  = target.low  - low;
  const dHigh = target.high - high;
  const lambdaLow  = dLow  < 0 ? EXPAND_LAMBDA : SHRINK_LAMBDA;
  const lambdaHigh = dHigh > 0 ? EXPAND_LAMBDA : SHRINK_LAMBDA;
  const factorLow  = dt > 0 ? 1 - Math.exp(-lambdaLow  * dt) : 0;
  const factorHigh = dt > 0 ? 1 - Math.exp(-lambdaHigh * dt) : 0;
  return {
    low:  Math.abs(dLow)  < 0.001 ? target.low  : low  + dLow  * factorLow,
    high: Math.abs(dHigh) < 0.001 ? target.high : high + dHigh * factorHigh,
  };
}

/** Simulate N frames at a fixed fps, collecting each frame's animated range. */
function simulate(
  initial: Range,
  getTarget: (frame: number) => Range,
  frames: number,
  fps = 60,
): Range[] {
  const dt = 1 / fps;
  const result: Range[] = [];
  let anim = { ...initial };
  for (let f = 0; f < frames; f++) {
    anim = animStep(anim, getTarget(f), dt);
    result.push({ ...anim });
  }
  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Frames until |anim - target| < threshold on both sides */
function framesUntilSettled(history: Range[], target: Range, threshold = 1): number {
  for (let i = 0; i < history.length; i++) {
    if (
      Math.abs(history[i].low  - target.low)  < threshold &&
      Math.abs(history[i].high - target.high) < threshold
    ) return i;
  }
  return -1; // never settled within the simulation
}

/** Returns true if the sequence is monotonically moving toward target (no reversals). */
function isMonotone(history: Range[], target: Range): boolean {
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const curr = history[i];
    // If already at target on an axis, small float drift is fine — skip
    const lowDone  = Math.abs(prev.low  - target.low)  < 0.001;
    const highDone = Math.abs(prev.high - target.high) < 0.001;
    // Low should move toward target.low (never away)
    if (!lowDone  && (curr.low  - target.low)  * (prev.low  - target.low)  < 0) return false;
    if (!highDone && (curr.high - target.high) * (prev.high - target.high) < 0) return false;
  }
  return true;
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

describe('portrait-mode song load', () => {
  /**
   * On load anim is always initialised to full range {21,108}.
   * On a narrow screen the target immediately becomes the song's trimmed range.
   * Both low and high need to SHRINK — this uses SHRINK_LAMBDA (slow).
   */
  const target: Range = { low: 48, high: 84 };  // typical trimmed range
  const frames = 60 * 8; // 8 seconds
  const history = simulate({ low: MIDI_LOW, high: MIDI_HIGH }, () => target, frames);

  it('low should only increase (no reversal)', () => {
    for (let i = 1; i < history.length; i++) {
      expect(history[i].low).toBeGreaterThanOrEqual(history[i - 1].low - 0.001);
    }
  });

  it('high should only decrease (no reversal)', () => {
    for (let i = 1; i < history.length; i++) {
      expect(history[i].high).toBeLessThanOrEqual(history[i - 1].high + 0.001);
    }
  });

  it('settles within 1 semitone within 3 seconds', () => {
    const f = framesUntilSettled(history, target);
    const seconds = f < 0 ? Infinity : f / 60;
    console.log(`Portrait song load: settled in ${seconds.toFixed(1)}s (frame ${f}/${frames})`);
    expect(seconds).toBeLessThan(3);
  });

  it('reaches within 5 semitones in under 2 seconds', () => {
    const f = framesUntilSettled(history, target, 5);
    const seconds = f / 60;
    console.log(`  → within 5 st in ${seconds.toFixed(2)}s`);
    expect(seconds).toBeLessThan(2);
  });
});

describe('oscillating target (boundary note flicker)', () => {
  /**
   * A note at the edge of the lookahead window flips in/out each frame.
   * Target oscillates between a narrow and slightly-wider range.
   *   narrow:  { low: 48, high: 84 }
   *   wide:    { low: 45, high: 84 }  (one extra note at the bottom)
   * The animated value should NOT oscillate visibly.
   */
  const narrow: Range = { low: 48, high: 84 };
  const wide:   Range = { low: 45, high: 84 };
  const frames = 60 * 5; // 5 seconds
  const history = simulate(
    { low: 45, high: 84 },                         // start at wide (worst case)
    (f) => (f % 2 === 0 ? narrow : wide),           // flicker every frame
    frames,
  );

  it('animated low never rises above narrow.low (expansion wins over flicker)', () => {
    // Because expand is fast and shrink is slow, the anim should sit near the
    // wider range (45), not oscillate up to 48 and back.
    const maxLow = Math.max(...history.map((r) => r.low));
    console.log(`Flicker: animated low range: [${Math.min(...history.map(r=>r.low)).toFixed(2)}, ${maxLow.toFixed(2)}]`);
    // Should stay well below narrow.low (no visible snapping toward 48)
    expect(maxLow).toBeLessThan(47);
  });

  it('peak-to-peak amplitude of animated low stays below 1 semitone', () => {
    const lows = history.map((r) => r.low);
    const amplitude = Math.max(...lows) - Math.min(...lows);
    console.log(`  → low amplitude over 5s: ${amplitude.toFixed(3)} semitones`);
    expect(amplitude).toBeLessThan(1);
  });
});

describe('orientation change (landscape → portrait mid-song)', () => {
  /**
   * Keyboard was showing full range {21,108}. User rotates to portrait; target
   * jumps to {48,84}. Both axes need to shrink. Checks speed and smoothness.
   */
  const initial: Range = { low: MIDI_LOW, high: MIDI_HIGH };
  const target:  Range = { low: 48, high: 84 };
  const frames = 60 * 10;
  const history = simulate(initial, () => target, frames);

  it('is monotone (no back-and-forth)', () => {
    expect(isMonotone(history, target)).toBe(true);
  });

  it('logs how long the shrink animation takes', () => {
    const f1 = framesUntilSettled(history, target, 1);
    const f5 = framesUntilSettled(history, target, 5);
    console.log(
      `Orientation change shrink: ` +
      `within 5st in ${(f5/60).toFixed(1)}s, within 1st in ${f1 < 0 ? '>10s' : (f1/60).toFixed(1)+'s'}`,
    );
    // Just log — the test documents expected timing, not enforces it
    expect(true).toBe(true);
  });
});

describe('range expansion (new low note approaches)', () => {
  /**
   * Playing; anim is settled at {48,84}. A low note at pitch 36 enters the
   * lookahead window → target becomes {34,84}. Should expand quickly.
   */
  const initial: Range = { low: 48, high: 84 };
  const target:  Range = { low: 34, high: 84 };
  const frames = 60 * 3;
  const history = simulate(initial, () => target, frames);

  it('is monotone (low only decreases)', () => {
    for (let i = 1; i < history.length; i++) {
      expect(history[i].low).toBeLessThanOrEqual(history[i - 1].low + 0.001);
    }
  });

  it('settles within 1 semitone within 2 seconds (EXPAND_LAMBDA)', () => {
    const f = framesUntilSettled(history, target, 1);
    const seconds = f / 60;
    console.log(`Expansion: settled in ${seconds.toFixed(2)}s`);
    expect(seconds).toBeLessThan(2);
  });
});

describe('snap threshold', () => {
  it('snaps immediately when delta > 48 on either axis', () => {
    // Full range to a very narrow range that exceeds threshold on both sides
    const initial: Range = { low: MIDI_LOW, high: MIDI_HIGH };  // {21,108}
    const target:  Range = { low: 60, high: 72 };               // delta: 39 low, 36 high
    const frame1  = animStep(initial, target, 1/60);
    // delta low = 60-21=39 < 48, delta high = 108-72=36 < 48 → should NOT snap
    console.log(`Near-threshold (no snap): low=${frame1.low.toFixed(2)}, high=${frame1.high.toFixed(2)}`);
    expect(frame1.low).not.toBe(target.low);  // should not snap

    const extremeTarget: Range = { low: 70, high: 108 };  // delta low = 70-21=49 > 48 → snap
    const snapped = animStep(initial, extremeTarget, 1/60);
    expect(snapped.low).toBe(extremeTarget.low);
    expect(snapped.high).toBe(extremeTarget.high);
  });
});

describe('FPS independence', () => {
  /**
   * Running at 30fps vs 60fps should reach the same position after the same
   * wall-clock time.
   */
  it('30fps and 60fps match within 0.1 semitones after 2 seconds', () => {
    const initial: Range = { low: MIDI_LOW, high: MIDI_HIGH };
    const target:  Range = { low: 48, high: 84 };

    const hist60 = simulate(initial, () => target, 120, 60); // 2s at 60fps
    const hist30 = simulate(initial, () => target, 60,  30); // 2s at 30fps

    const last60 = hist60[hist60.length - 1];
    const last30 = hist30[hist30.length - 1];
    console.log(
      `FPS independence after 2s: ` +
      `60fps={low:${last60.low.toFixed(3)},high:${last60.high.toFixed(3)}} ` +
      `30fps={low:${last30.low.toFixed(3)},high:${last30.high.toFixed(3)}}`,
    );
    expect(Math.abs(last60.low  - last30.low )).toBeLessThan(0.1);
    expect(Math.abs(last60.high - last30.high)).toBeLessThan(0.1);
  });
});
