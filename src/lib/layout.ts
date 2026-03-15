export const SIDEBAR_WIDTH = 36;
export const MIDI_LOW = 21;
export const MIDI_HIGH = 108;

export const NOTE_COLORS = [
  '#7c6af7', '#f77c6a', '#6af7b8', '#f7e96a',
  '#6ab4f7', '#f76ac8', '#aef76a',
];

const BLACK_OFFSETS = new Set([1, 3, 6, 8, 10]);

export function isBlack(midi: number) {
  return BLACK_OFFSETS.has(midi % 12);
}

export interface KeyGeom {
  x: number;
  w: number;
  isBlack: boolean;
}

export function countWhiteKeys(low: number, high: number): number {
  let count = 0;
  for (let m = low; m <= high; m++) {
    if (!isBlack(m)) count++;
  }
  return count;
}

export function buildKeyGeometryForRange(rollWidth: number, low: number, high: number): Map<number, KeyGeom> {
  const whites: number[] = [];
  for (let m = low; m <= high; m++) {
    if (!isBlack(m)) whites.push(m);
  }
  if (whites.length === 0) return new Map();
  const wkW = rollWidth / whites.length;
  const bkW = wkW * 0.60;

  const map = new Map<number, KeyGeom>();
  whites.forEach((midi, i) => {
    map.set(midi, { x: i * wkW, w: wkW - 1, isBlack: false });
  });
  whites.forEach((midi, i) => {
    const nb = midi + 1;
    if (isBlack(nb) && nb <= high) {
      const cx = (i + 1) * wkW;
      map.set(nb, { x: cx - bkW / 2, w: bkW, isBlack: true });
    }
  });
  return map;
}

export function buildKeyGeometry(rollWidth: number): Map<number, KeyGeom> {
  return buildKeyGeometryForRange(rollWidth, MIDI_LOW, MIDI_HIGH);
}

export function shadeColor(hex: string, amount: number): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (num & 0xff) + amount));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export function hexToRgb(hex: string): { r: number, g: number, b: number } {
  const num = parseInt(hex.slice(1), 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function triggerFrac(pos: 'top' | 'middle' | 'bottom'): number {
  return pos === 'bottom' ? 1.0 : pos === 'middle' ? 0.5 : 0.15;
}
