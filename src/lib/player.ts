import * as Tone from 'tone';
import type { NoteEvent } from './types';

// Soundfont base URL (midi.js soundfonts from GitHub CDN)
const SOUNDFONT_BASE = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM';

// Map MIDI pitch to note name for soundfont-player
const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES[midi % 12];
  return `${name}${octave}`;
}

type AudioBuffer = globalThis.AudioBuffer;

interface SoundfontInstrument {
  play: (
    note: string,
    audioContext: AudioContext,
    options?: { gain?: number; duration?: number; when?: number }
  ) => AudioBufferSourceNode;
  scheduleNote?: (note: string, when: number, duration: number, gain: number) => void;
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Soundfont?: any;
  }
}

export type PlayerStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused';

export class Player {
  private audioCtx: AudioContext | null = null;
  private buffers: Map<number, AudioBuffer> = new Map(); // pitch -> decoded buffer
  private rawBuffers: Map<string, ArrayBuffer> = new Map(); // note name -> raw
  private scheduledSources: AudioBufferSourceNode[] = [];
  private gainNode: GainNode | null = null;

  private notes: NoteEvent[] = [];
  private transpose = 0;
  private bpm = 120;
  private playbackRate = 1.0;
  private duration = 0;

  private startedAt = 0; // AudioContext.currentTime when play started
  private pausedAt = 0; // position in song (seconds) when paused

  status: PlayerStatus = 'idle';
  onStatusChange: (s: PlayerStatus) => void = () => {};
  onTimeUpdate: (t: number) => void = () => {};

  private rafId: number | null = null;
  private uniquePitches: Set<number> = new Set();
  private lastRescheduleAt = 0;
  private rescheduleTimer: number | null = null;

  private setStatus(s: PlayerStatus) {
    this.status = s;
    this.onStatusChange(s);
  }

  async load(notes: NoteEvent[], bpm: number, transpose: number, duration: number): Promise<void> {
    this.stop();
    this.notes = notes;
    this.bpm = bpm;
    this.transpose = transpose;
    this.duration = duration;

    this.uniquePitches = new Set(
      notes.map((n) => Math.max(0, Math.min(127, n.pitch + transpose)))
    );

    this.setStatus('loading');

    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.connect(this.audioCtx.destination);
    }

    await this.loadBuffers();
    this.pausedAt = 0;
    this.setStatus('ready');
  }

  private async loadBuffers(): Promise<void> {
    if (!this.audioCtx) return;

    const pitchesToLoad = Array.from(this.uniquePitches).filter(
      (p) => !this.buffers.has(p)
    );

    const fetchPromises = pitchesToLoad.map(async (pitch) => {
      const name = midiToNoteName(pitch);
      const url = `${SOUNDFONT_BASE}/acoustic_grand_piano-mp3/${name}.mp3`;
      try {
        const resp = await fetch(url);
        if (!resp.ok) return;
        const arrayBuf = await resp.arrayBuffer();
        const decoded = await this.audioCtx!.decodeAudioData(arrayBuf.slice(0));
        this.buffers.set(pitch, decoded);
        this.rawBuffers.set(name, arrayBuf);
      } catch {
        // ignore missing notes
      }
    });

    await Promise.all(fetchPromises);
  }

  play(): void {
    if (!this.audioCtx || this.status === 'loading') return;
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

    this.clearScheduled();

    const offset = this.pausedAt;
    // Account for playback rate when calculating the wall-clock start time.
    // Song time = (wall clock time - startedAt) * playbackRate
    this.startedAt = this.audioCtx.currentTime - (offset / this.playbackRate);

    const now = this.audioCtx.currentTime;
    const LOOKAHEAD = 0; // schedule all notes at once

    this.notes.forEach((note) => {
      const pitch = Math.max(0, Math.min(127, note.pitch + this.transpose));
      const buf = this.buffers.get(pitch);
      if (!buf || note.startTime < offset - 0.1) return;

      const when = now + (note.startTime - offset) / this.playbackRate;
      if (when < now - 0.01) return;

      const src = this.audioCtx!.createBufferSource();
      src.buffer = buf;
      const gain = this.audioCtx!.createGain();
      gain.gain.value = (note.velocity / 127) * 0.8;
      src.connect(gain);
      gain.connect(this.gainNode!);
      src.start(Math.max(when, now + LOOKAHEAD));
      src.stop(Math.max(when, now) + note.duration / this.playbackRate + 0.3);
      this.scheduledSources.push(src);
    });

    this.setStatus('playing');
    this.startRaf();
  }

  pause(): void {
    if (!this.audioCtx || this.status !== 'playing') return;
    this.pausedAt = this.getCurrentTime();
    this.clearScheduled();
    this.stopRaf();
    this.setStatus('paused');
  }

  stop(): void {
    this.clearScheduled();
    this.stopRaf();
    this.pausedAt = 0;
    if (this.status === 'playing' || this.status === 'paused') {
      this.setStatus('ready');
    }
    this.onTimeUpdate(0);
  }

  seek(time: number): void {
    const wasPlaying = this.status === 'playing';
    if (wasPlaying) this.clearScheduled();
    this.pausedAt = time;
    if (wasPlaying) {
      this.play();
    } else {
      this.onTimeUpdate(time);
    }
  }

  setPlaybackRate(rate: number): void {
    const wasPlaying = this.status === 'playing';
    const currentTime = this.getCurrentTime();
    
    this.playbackRate = rate;
    
    if (wasPlaying) {
      if (this.rescheduleTimer) clearTimeout(this.rescheduleTimer);
      
      const now = Date.now();
      if (now - this.lastRescheduleAt > 150) {
        this.doReschedule(currentTime);
      } else {
        this.rescheduleTimer = window.setTimeout(() => {
          this.doReschedule(this.getCurrentTime());
        }, 150);
      }
    }
  }

  private doReschedule(time: number): void {
    if (this.status !== 'playing') return;
    this.lastRescheduleAt = Date.now();
    this.rescheduleTimer = null;
    this.clearScheduled();
    this.pausedAt = time;
    this.play();
  }

  /** Call when transpose changes — reload buffers for new pitches then reschedule */
  async updateTranspose(transpose: number): Promise<void> {
    const wasPlaying = this.status === 'playing';
    const position = this.getCurrentTime();

    if (wasPlaying) {
      this.clearScheduled();
      this.stopRaf();
    }

    this.transpose = transpose;
    this.uniquePitches = new Set(
      this.notes.map((n) => Math.max(0, Math.min(127, n.pitch + transpose)))
    );

    await this.loadBuffers();

    this.pausedAt = position;
    if (wasPlaying) this.play();
  }

  getCurrentTime(): number {
    if (this.status === 'playing' && this.audioCtx) {
      return (this.audioCtx.currentTime - this.startedAt) * this.playbackRate;
    }
    return this.pausedAt;
  }

  private clearScheduled(): void {
    this.scheduledSources.forEach((src) => {
      try { src.stop(); } catch { /* already stopped */ }
      src.disconnect();
    });
    this.scheduledSources = [];
  }

  private startRaf(): void {
    const tick = () => {
      if (this.status === 'playing') {
        const now = this.getCurrentTime();
        this.onTimeUpdate(now);

        // Auto-stop at end of song (with 0.5s padding)
        if (now >= this.duration + 0.5) {
          this.stop();
          return;
        }

        this.rafId = requestAnimationFrame(tick);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopRaf(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}

// Singleton
export const player = new Player();
