#!/usr/bin/env node
/**
 * Downloads all acoustic grand piano MP3 samples (MIDI 21–108, A0–C8) from the
 * gleitz/midi-js-soundfonts FluidR3_GM CDN into public/soundfonts/ so the app
 * can play audio fully offline (required for Capacitor / Tauri packaging).
 *
 * Usage:  node scripts/download-soundfonts.mjs
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const OUT_DIR   = join(ROOT, 'public', 'soundfonts', 'acoustic_grand_piano-mp3');
const BASE_URL  = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_grand_piano-mp3';

const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function midiToNoteName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  const name   = NOTE_NAMES[midi % 12];
  return `${name}${octave}`;
}

/** Minimal fetch with a simple retry for transient failures */
async function fetchWithRetry(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`  Retry ${attempt}/${retries - 1} for ${url}`);
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
}

async function main() {
  if (!existsSync(OUT_DIR)) {
    mkdirSync(OUT_DIR, { recursive: true });
    console.log(`Created ${OUT_DIR}`);
  }

  const pitches = [];
  for (let midi = 21; midi <= 108; midi++) {
    pitches.push(midi);
  }

  console.log(`Downloading ${pitches.length} samples to ${OUT_DIR} …`);

  let downloaded = 0;
  let skipped    = 0;

  // Download in batches of 8 to avoid hammering the CDN
  const BATCH = 8;
  for (let i = 0; i < pitches.length; i += BATCH) {
    const batch = pitches.slice(i, i + BATCH);
    await Promise.all(batch.map(async (midi) => {
      const name = midiToNoteName(midi);
      const dest = join(OUT_DIR, `${name}.mp3`);
      if (existsSync(dest)) {
        skipped++;
        return;
      }
      const url = `${BASE_URL}/${name}.mp3`;
      try {
        const data = await fetchWithRetry(url);
        writeFileSync(dest, data);
        downloaded++;
        process.stdout.write(`  ✓ ${name}.mp3\n`);
      } catch (err) {
        console.error(`  ✗ ${name}.mp3 — ${err.message}`);
      }
    }));
  }

  console.log(`\nDone. Downloaded: ${downloaded}, Skipped (already exist): ${skipped}`);
}

main().catch(err => { console.error(err); process.exit(1); });
