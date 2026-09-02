#!/usr/bin/env node
/**
 * Royalty-free by construction: synthesises public/ambient.wav from scratch (no deps,
 * no samples, no library) and compresses it to public/ambient.m4a with ffmpeg.
 *
 * A slow pad of detuned sines around 55 / 82.4 / 110 Hz (A1, E2, A2) under a faint
 * low-passed noise bed. Nothing here is anyone else's copyright.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');

const SAMPLE_RATE = 48000;
const DURATION_S = 160;
const CHANNELS = 2;
const FADE_IN_S = 6;
const FADE_OUT_S = 8;
const PEAK_DBFS = -24;
const NOISE_DBFS = -40;

const dbToLin = (db) => 10 ** (db / 20);
const TAU = Math.PI * 2;

/** base Hz, detune ratio, LFO Hz, LFO phase, gain, pan (-1 L .. +1 R) */
const VOICES = [
  { f: 55.0, detune: -0.0031, lfo: 0.051, phase: 0.0, gain: 1.0, pan: -0.35 },
  { f: 55.0, detune: 0.0042, lfo: 0.067, phase: 1.7, gain: 0.9, pan: 0.4 },
  { f: 82.4, detune: -0.0024, lfo: 0.083, phase: 2.9, gain: 0.62, pan: 0.25 },
  { f: 82.4, detune: 0.0037, lfo: 0.096, phase: 0.6, gain: 0.55, pan: -0.3 },
  { f: 110.0, detune: -0.0019, lfo: 0.113, phase: 4.1, gain: 0.34, pan: -0.15 },
  { f: 110.0, detune: 0.0028, lfo: 0.129, phase: 3.2, gain: 0.3, pan: 0.2 },
  { f: 164.8, detune: 0.0015, lfo: 0.073, phase: 5.4, gain: 0.11, pan: 0.05 },
];

const total = SAMPLE_RATE * DURATION_S;
const left = new Float64Array(total);
const right = new Float64Array(total);

// --- pad -------------------------------------------------------------------
for (const v of VOICES) {
  const w = (TAU * v.f * (1 + v.detune)) / SAMPLE_RATE;
  const lw = (TAU * v.lfo) / SAMPLE_RATE;
  // equal-power pan
  const angle = ((v.pan + 1) / 2) * (Math.PI / 2);
  const gl = Math.cos(angle) * v.gain;
  const gr = Math.sin(angle) * v.gain;
  for (let i = 0; i < total; i += 1) {
    // LFO stays positive: 0.25 .. 1.0, so voices breathe but never fully drop out
    const env = 0.625 + 0.375 * Math.sin(lw * i + v.phase);
    const s = Math.sin(w * i) * env;
    left[i] += s * gl;
    right[i] += s * gr;
  }
}

// normalise the pad to peak 1.0 before the noise bed is mixed in at a known level
let padPeak = 0;
for (let i = 0; i < total; i += 1) {
  padPeak = Math.max(padPeak, Math.abs(left[i]), Math.abs(right[i]));
}
for (let i = 0; i < total; i += 1) {
  left[i] /= padPeak;
  right[i] /= padPeak;
}

// --- noise bed: white noise low-passed with a moving average ---------------
const WINDOW = 96; // ~ a few hundred Hz of usable bandwidth at 48 kHz
const noiseGain = dbToLin(NOISE_DBFS);
let seed = 0x1a2b3c4d;
const rnd = () => {
  // xorshift32, so the bed is identical on every machine
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return (seed / 0xffffffff) * 2 - 1;
};
for (const channel of [left, right]) {
  const ring = new Float64Array(WINDOW);
  let sum = 0;
  let head = 0;
  for (let i = 0; i < total; i += 1) {
    const n = rnd();
    sum -= ring[head];
    ring[head] = n;
    sum += n;
    head = (head + 1) % WINDOW;
    // a moving average of white noise is quiet; scale back up to full range first
    channel[i] += (sum / WINDOW) * Math.sqrt(WINDOW) * noiseGain;
  }
}

// --- fades -----------------------------------------------------------------
const fadeIn = FADE_IN_S * SAMPLE_RATE;
const fadeOut = FADE_OUT_S * SAMPLE_RATE;
for (let i = 0; i < fadeIn; i += 1) {
  const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeIn); // raised cosine
  left[i] *= g;
  right[i] *= g;
}
for (let i = 0; i < fadeOut; i += 1) {
  const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeOut);
  const idx = total - 1 - i;
  left[idx] *= g;
  right[idx] *= g;
}

// --- normalise to the target peak -----------------------------------------
let peak = 0;
for (let i = 0; i < total; i += 1) {
  peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
}
const target = dbToLin(PEAK_DBFS);
const gain = target / peak;

// --- 16-bit PCM WAV --------------------------------------------------------
const bytesPerSample = 2;
const dataBytes = total * CHANNELS * bytesPerSample;
const buf = Buffer.alloc(44 + dataBytes);
buf.write('RIFF', 0, 'ascii');
buf.writeUInt32LE(36 + dataBytes, 4);
buf.write('WAVE', 8, 'ascii');
buf.write('fmt ', 12, 'ascii');
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); // PCM
buf.writeUInt16LE(CHANNELS, 22);
buf.writeUInt32LE(SAMPLE_RATE, 24);
buf.writeUInt32LE(SAMPLE_RATE * CHANNELS * bytesPerSample, 28);
buf.writeUInt16LE(CHANNELS * bytesPerSample, 32);
buf.writeUInt16LE(8 * bytesPerSample, 34);
buf.write('data', 36, 'ascii');
buf.writeUInt32LE(dataBytes, 40);

let off = 44;
let rmsAcc = 0;
for (let i = 0; i < total; i += 1) {
  const l = Math.max(-1, Math.min(1, left[i] * gain));
  const r = Math.max(-1, Math.min(1, right[i] * gain));
  rmsAcc += (l * l + r * r) / 2;
  buf.writeInt16LE(Math.round(l * 32767), off);
  buf.writeInt16LE(Math.round(r * 32767), off + 2);
  off += 4;
}

mkdirSync(PUBLIC, { recursive: true });
const wav = join(PUBLIC, 'ambient.wav');
writeFileSync(wav, buf);
const rmsDb = 10 * Math.log10(rmsAcc / total);
console.log(
  `wrote ${wav} — ${DURATION_S}s, ${SAMPLE_RATE} Hz, ${CHANNELS} ch, peak ${PEAK_DBFS} dBFS, rms ${rmsDb.toFixed(1)} dBFS, ${(statSync(wav).size / 1e6).toFixed(1)} MB`,
);

const m4a = join(PUBLIC, 'ambient.m4a');
execFileSync(
  'ffmpeg',
  ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-c:a', 'aac', '-b:a', '128k', m4a],
  { stdio: 'inherit' },
);
console.log(`wrote ${m4a} — aac 128k, ${(statSync(m4a).size / 1e6).toFixed(1)} MB`);
