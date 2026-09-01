#!/usr/bin/env node
/**
 * Vendor the sky catalogs from d3-celestial (BSD-3-Clause, (c) 2015 Olaf Frohn)
 * into compact JSON under src/data/.
 *
 *   node scripts/vendor-catalogs.mjs        # fetch from GitHub and rewrite src/data/
 *   node scripts/vendor-catalogs.mjs --dry  # build everything, print sizes, write nothing
 *
 * Set ROQUE_CATALOG_CACHE=<dir> to read the upstream files from a local directory
 * instead of the network (the script still writes nothing else there).
 *
 * Source coordinates are GeoJSON [RA_deg, Dec_deg] with RA wrapped to -180..180
 * (the d3-geo convention). Everything we emit uses RA normalised to [0, 360).
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'src', 'data');
const BASE = 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data';
const CACHE = process.env.ROQUE_CATALOG_CACHE || null;
const DRY = process.argv.includes('--dry');

/** Hard size caps. A build that would exceed one of these refuses to write. */
const CAPS = {
  'stars.json': 220_000,
  'milkyway.json': 120_000,
};

const SOURCES = {
  stars: 'stars.6.json',
  starnames: 'starnames.json',
  conLines: 'constellations.lines.json',
  conNames: 'constellations.json',
  conBorders: 'constellations.borders.json',
  messier: 'messier.json',
  mw: 'mw.json',
};

const LICENSE = 'BSD-3-Clause';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const norm360 = (ra) => {
  const r = ra % 360;
  return r < 0 ? r + 360 : r;
};

/** Signed difference a-b folded into (-180, 180]. */
const wrap180 = (d) => {
  const x = ((d + 180) % 360 + 360) % 360 - 180;
  return x;
};

const round = (v, dp) => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

/** Round an RA and guarantee the result stays strictly inside [0, 360). */
const roundRa = (ra, dp) => {
  const r = round(norm360(ra), dp);
  return r >= 360 ? round(360 - 10 ** -dp, dp) : r;
};

const roundDec = (dec, dp) => Math.min(90, Math.max(-90, round(dec, dp)));

async function load(file) {
  if (CACHE) {
    const p = join(CACHE, file);
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  }
  const url = `${BASE}/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json();
}

const fail = (msg) => {
  throw new Error(msg);
};

// ---------------------------------------------------------------------------
// 1. stars
// ---------------------------------------------------------------------------

const DEFAULT_BV = 0.65; // sun-like white/yellow; used when the source bv is empty

function buildStars(starsGeo, starNames, magCut) {
  let missingBv = 0;
  const rows = [];
  for (const f of starsGeo.features) {
    const mag = f.properties.mag;
    if (typeof mag !== 'number' || !Number.isFinite(mag) || mag > magCut) continue;

    let bv = Number.parseFloat(f.properties.bv);
    if (!Number.isFinite(bv)) {
      bv = DEFAULT_BV;
      missingBv++;
    }

    const hip = Number.isFinite(f.id) ? f.id : 0;
    const entry = starNames[String(hip)];
    const name = entry && typeof entry.name === 'string' ? entry.name : '';

    rows.push([
      roundRa(f.geometry.coordinates[0], 4),
      roundDec(f.geometry.coordinates[1], 4),
      round(mag, 2),
      round(bv, 2),
      name,
      hip,
    ]);
  }
  // brightest first, so a renderer can just take a prefix; hip breaks ties
  // so the output is byte-identical across runs.
  rows.sort((a, b) => a[2] - b[2] || a[5] - b[5]);
  return { rows, missingBv, named: rows.filter((r) => r[4] !== '').length };
}

// ---------------------------------------------------------------------------
// 2. constellations
// ---------------------------------------------------------------------------

/**
 * Normalise a polyline to [0,360) and cut it wherever it crosses the RA=0/360
 * seam, inserting the interpolated seam point on both sides so the renderer
 * draws right up to the edge instead of leaving a gap — and never draws a
 * chord across the whole sky.
 */
function splitAtSeam(points, dp) {
  const out = [];
  let cur = [];
  for (let i = 0; i < points.length; i++) {
    const ra = norm360(points[i][0]);
    const dec = points[i][1];
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const d = wrap180(ra - prev.ra);
      if (Math.abs(prev.ra + d - ra) > 1e-9) {
        // the short path leaves [0,360): interpolate the dec at the seam
        const target = d > 0 ? 360 : 0;
        const t = (target - prev.ra) / d;
        const decSeam = prev.dec + t * (dec - prev.dec);
        cur.push({ ra: target, dec: decSeam });
        out.push(cur);
        cur = [{ ra: target === 360 ? 0 : 360, dec: decSeam }];
      }
    }
    cur.push({ ra, dec });
  }
  if (cur.length) out.push(cur);

  // An exact 360 is a seam endpoint, not a coordinate: norm360 would fold it
  // back to 0 and re-create the very jump we just split out. Emit the largest
  // representable RA below 360 instead.
  const seamHi = round(360 - 10 ** -dp, dp);
  const ra = (v) => (v === 360 ? seamHi : roundRa(v, dp));

  return out
    .map((seg) => seg.map((p) => [ra(p.ra), roundDec(p.dec, dp)]))
    .filter((seg) => seg.length >= 2);
}

function buildConstellations(linesGeo, namesGeo) {
  // Serpens ships as two features under the same id ("Serpens Caput" and
  // "Serpens Cauda"), with a label position each. Group by id so nothing is
  // silently dropped.
  const grouped = new Map();
  for (const f of namesGeo.features) {
    if (!grouped.has(f.id)) grouped.set(f.id, []);
    grouped.get(f.id).push(f);
  }

  const names = new Map();
  for (const [id, feats] of grouped) {
    const distinct = new Set(feats.map((f) => f.properties.name).filter(Boolean));
    const latin = new Set(feats.map((f) => f.properties.la).filter(Boolean));
    // When the halves disagree ("Serpens Caput" vs "Serpens Cauda") fall back to
    // the shared Latin name, which is the IAU constellation name ("Serpens").
    const name =
      distinct.size === 1
        ? [...distinct][0]
        : latin.size === 1
          ? [...latin][0]
          : feats[0].properties.name || id;
    const labels = feats.map((f) => [
      roundRa(f.geometry.coordinates[0], 3),
      roundDec(f.geometry.coordinates[1], 3),
    ]);
    names.set(id, { name, labelRa: labels[0][0], labelDec: labels[0][1], labels });
  }

  // Merge the two Serpens line features into a single record so every id is
  // unique and consumers can key by it. `lines` is a list of polylines, so the
  // merge is lossless.
  const byId = new Map();
  let seamSplits = 0;
  for (const f of linesGeo.features) {
    const meta = names.get(f.id) || { name: f.id, labelRa: 0, labelDec: 0, labels: [[0, 0]] };
    if (!byId.has(f.id)) byId.set(f.id, { id: f.id, ...meta, lines: [] });
    const rec = byId.get(f.id);
    const multi =
      f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const line of multi) {
      const parts = splitAtSeam(line, 3);
      if (parts.length > 1) seamSplits += parts.length - 1;
      rec.lines.push(...parts);
    }
  }

  const constellations = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { constellations, seamSplits, sourceFeatures: linesGeo.features.length };
}

// ---------------------------------------------------------------------------
// 3. messier
// ---------------------------------------------------------------------------

/**
 * Every d3-celestial DSO type code we can meet, mapped explicitly.
 * messier.json only uses: snr gc oc sfr pos pn s e rn i — the rest are here so
 * an upstream data refresh can't silently fall through to "other".
 */
const TYPE_MAP = {
  g: 'galaxy', // galaxy, unspecified
  s: 'galaxy', // spiral galaxy
  s0: 'galaxy', // lenticular galaxy
  e: 'galaxy', // elliptical galaxy
  i: 'galaxy', // irregular galaxy
  oc: 'open_cluster',
  gc: 'globular_cluster',
  pn: 'planetary_nebula',
  snr: 'supernova_remnant',
  sfr: 'diffuse_nebula', // star-forming region (emission nebula)
  en: 'diffuse_nebula', // emission nebula
  rn: 'diffuse_nebula', // reflection nebula
  dn: 'diffuse_nebula', // dark nebula
  bn: 'diffuse_nebula', // bright nebula
  pos: 'other', // position only: star cloud / double star / asterism
  sd: 'other', // star cloud
  ast: 'other', // asterism
  dc: 'other', // double star
};

const ALLOWED_TYPES = new Set(Object.values(TYPE_MAP));

/** Largest dimension in arcmin parsed out of strings like "190x60", "13", "". */
function parseSize(dim) {
  if (typeof dim !== 'string') return null;
  const nums = dim.match(/\d+(?:\.\d+)?/g);
  if (!nums || !nums.length) return null;
  return Math.max(...nums.map(Number));
}

/**
 * Build a point-in-constellation test out of constellations.borders.json.
 * Each border feature carries `ids: "And,Lac"` — the constellations it
 * separates — so the union of every segment tagged with X is exactly X's
 * boundary, and we can ray-cast without stitching the segments into rings.
 *
 * The ray runs from the point down to the south pole, which is valid for every
 * constellation except the one containing that pole (Octans), handled by
 * elimination.
 */
function makeConstellationLocator(bordersGeo) {
  const segs = new Map();
  for (const f of bordersGeo.features) {
    const ids = String(f.ids ?? f.properties?.ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids.length) continue;
    const multi =
      f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const line of multi) {
      for (let i = 0; i < line.length - 1; i++) {
        const s = [line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]];
        for (const id of ids) {
          if (!segs.has(id)) segs.set(id, []);
          segs.get(id).push(s);
        }
      }
    }
  }

  const inside = (con, ra, dec) => {
    const list = segs.get(con);
    if (!list) return false;
    let crossings = 0;
    for (const [r1, d1, r2, d2] of list) {
      const a = wrap180(r1 - ra);
      const b = wrap180(r2 - ra);
      if (Math.abs(a - b) >= 180) continue; // straddles the antimeridian of P
      if (a === 0 || b === 0) continue;
      if (a > 0 === b > 0) continue; // does not span P's meridian
      const decAt = d1 + (a / (a - b)) * (d2 - d1);
      if (decAt < dec) crossings++;
    }
    return crossings % 2 === 1;
  };

  return {
    count: segs.size,
    locate(ra, dec) {
      const hits = [];
      for (const con of segs.keys()) {
        if (con === 'Oct') continue;
        if (inside(con, ra, dec)) hits.push(con);
      }
      if (hits.length === 1) return hits[0];
      if (hits.length === 0) return dec < -70 ? 'Oct' : null;
      return null; // ambiguous — caller fails loudly
    },
  };
}

/**
 * Golden coordinates (J2000, SIMBAD) that must survive the RA un-wrapping and
 * rounding. `tol` is the accepted offset in degrees.
 *
 * M42 gets 0.08 instead of 0.05: d3-celestial places the Orion Nebula at
 * dec -5.45 where SIMBAD says -5.391, a 3.6' difference inside a nebula 66'
 * across — an upstream centroid choice, not a coordinate bug. The other three
 * land within 0.01 deg, which is what actually proves the transform is right.
 */
const GOLDEN = {
  M31: { ra: 10.685, dec: 41.269, tol: 0.05 },
  M42: { ra: 83.82, dec: -5.39, tol: 0.08 },
  M45: { ra: 56.75, dec: 24.12, tol: 0.05 },
  M13: { ra: 250.42, dec: 36.46, tol: 0.05 },
};

function buildMessier(messierGeo, locator) {
  const objects = [];
  const usedCodes = new Map();
  const otherIds = [];

  for (const f of messierGeo.features) {
    const p = f.properties;
    const code = String(p.type || '').toLowerCase();
    const type = TYPE_MAP[code];
    if (!type) fail(`messier.json: unmapped type code "${code}" on ${f.id} — add it to TYPE_MAP`);
    usedCodes.set(code, type);
    if (type === 'other') otherIds.push(f.id);

    const ra = norm360(f.geometry.coordinates[0]);
    const dec = f.geometry.coordinates[1];
    const con = locator.locate(ra, dec);
    if (!con) fail(`could not place ${f.id} (ra=${ra.toFixed(3)} dec=${dec.toFixed(3)}) in a constellation`);

    objects.push({
      id: f.id,
      name: p.alt || p.desig || f.id,
      type,
      ra: round(ra, 3),
      dec: roundDec(dec, 3),
      mag: typeof p.mag === 'number' && Number.isFinite(p.mag) ? round(p.mag, 2) : null,
      sizeArcmin: parseSize(p.dim),
      con,
    });
  }

  objects.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));

  // --- loud checks ---------------------------------------------------------
  if (objects.length !== 110) fail(`expected 110 Messier objects, got ${objects.length}`);
  for (let i = 0; i < 110; i++) {
    const want = `M${i + 1}`;
    if (objects[i].id !== want) fail(`Messier ids are not M1..M110 (index ${i} is ${objects[i].id})`);
  }
  const goldenNotes = [];
  for (const [id, g] of Object.entries(GOLDEN)) {
    const o = objects.find((x) => x.id === id);
    if (!o) fail(`golden check: ${id} missing`);
    const dRa = Math.abs(wrap180(o.ra - g.ra));
    const dDec = Math.abs(o.dec - g.dec);
    if (dRa > g.tol || dDec > g.tol) {
      fail(
        `golden check FAILED for ${id}: got ra=${o.ra} dec=${o.dec}, want ~${g.ra}/${g.dec} ` +
          `(off by ${dRa.toFixed(4)}/${dDec.toFixed(4)} deg, tolerance ${g.tol})`,
      );
    }
    if (dRa > 0.05 || dDec > 0.05) {
      goldenNotes.push(
        `${id} is ${Math.max(dRa, dDec).toFixed(3)} deg from the SIMBAD position (upstream centroid, within tolerance ${g.tol})`,
      );
    }
  }
  for (const o of objects) {
    if (!ALLOWED_TYPES.has(o.type)) fail(`${o.id} has type "${o.type}" outside the allowed set`);
  }

  return { objects, typeMapping: Object.fromEntries([...usedCodes].sort()), otherIds, goldenNotes };
}

// ---------------------------------------------------------------------------
// 4. milky way
// ---------------------------------------------------------------------------

/** Perpendicular distance from p to segment a-b, in the (ra, dec) plane. */
function segDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Iterative Douglas-Peucker (recursion would blow the stack on 5 470 points). */
function douglasPeucker(pts, tol) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let best = -1;
    let bestD = tol;
    for (let i = lo + 1; i < hi; i++) {
      const d = segDist(pts[i], pts[lo], pts[hi]);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best !== -1) {
      keep[best] = 1;
      stack.push([lo, best], [best, hi]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/** Make RA continuous across the seam so distances near RA=0 mean something. */
function unwrapRa(ring) {
  const out = [[ring[0][0], ring[0][1]]];
  for (let i = 1; i < ring.length; i++) {
    const prev = out[i - 1][0];
    out.push([prev + wrap180(ring[i][0] - prev), ring[i][1]]);
  }
  return out;
}

/** Shoelace area in deg^2, used only to drop specks. */
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(a / 2);
}

/**
 * Tried in order; the first one that fits under the size cap wins. The finest
 * step is the default: 0.1 deg is sub-pixel on a retina full-sky dome, and the
 * ~5 000 resulting points cost nothing to fill on a canvas. The coarser steps
 * exist so an upstream data refresh degrades gracefully instead of failing.
 */
const MW_STEPS = [
  { tol: 0.1, minArea: 0.3 },
  { tol: 0.15, minArea: 0.4 },
  { tol: 0.2, minArea: 0.5 },
  { tol: 0.3, minArea: 1 },
  { tol: 0.4, minArea: 2 },
  { tol: 0.5, minArea: 4 },
  { tol: 0.7, minArea: 8 },
  { tol: 0.9, minArea: 12 },
  { tol: 1.2, minArea: 20 },
];

/**
 * Does this closed ring, once normalised to [0,360), actually straddle the
 * RA=0/360 seam? Checked on the normalised values with the ring closed
 * (last -> first), not on the unwrapped working copy.
 */
function ringCrossesSeam(normalised) {
  for (let i = 0; i < normalised.length; i++) {
    const a = normalised[i][0];
    const b = normalised[(i + 1) % normalised.length][0];
    if (Math.abs(a - b) > 180) return true;
  }
  return false;
}

function buildMilkyWayAt(mwGeo, tol, minArea) {
  const levels = [];
  let ringsIn = 0;
  let ringsOut = 0;
  let ptsIn = 0;
  let ptsOut = 0;
  let wrapRings = 0;

  for (const f of mwGeo.features) {
    const polygons = [];
    const multi =
      f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const poly of multi) {
      for (const ring of poly) {
        ringsIn++;
        ptsIn += ring.length;
        if (ring.length < 4) continue;

        const closed =
          ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
        const open = closed ? ring.slice(0, -1) : ring;
        if (open.length < 4) continue;

        const cont = unwrapRa(open);
        const simplified = douglasPeucker(cont, tol);
        if (simplified.length < 4) continue;
        if (ringArea(simplified) < minArea) continue;

        const ringOut = simplified.map((p) => [roundRa(p[0], 2), roundDec(p[1], 2)]);
        if (ringCrossesSeam(ringOut)) wrapRings++;

        // Re-close the ring. Douglas-Peucker ran on the open sequence, so the
        // closing vertex has to be put back: these are fill polygons, and a
        // renderer that strokes the isophote (rather than filling it) would
        // otherwise leave a gap of up to a fifth of a degree on the last edge.
        const first = ringOut[0];
        const last = ringOut[ringOut.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) ringOut.push([first[0], first[1]]);

        polygons.push(ringOut);
        ringsOut++;
        ptsOut += ringOut.length;
      }
    }
    levels.push({ id: f.id, polygons });
  }
  return { levels, ringsIn, ringsOut, ptsIn, ptsOut, wrapRings };
}

// ---------------------------------------------------------------------------
// serialisation + size reporting
// ---------------------------------------------------------------------------

const report = [];

function emit(name, value) {
  const buf = Buffer.from(JSON.stringify(value) + '\n', 'utf8');
  const gz = gzipSync(buf).length;
  const cap = CAPS[name];
  if (cap && buf.length > cap) {
    fail(`${name} is ${buf.length} B, over its ${cap} B cap — refusing to write`);
  }
  const path = join(OUT_DIR, name);
  if (!DRY) writeFileSync(path, buf);
  report.push({ path: relative(ROOT, path), bytes: buf.length, gzipBytes: gz, cap: cap ?? null });
  return buf.length;
}

function emitText(absPath, text) {
  const buf = Buffer.from(text, 'utf8');
  if (!DRY) writeFileSync(absPath, buf);
  report.push({
    path: relative(ROOT, absPath),
    bytes: buf.length,
    gzipBytes: gzipSync(buf).length,
    cap: null,
  });
}

function printTable() {
  const w = (s, n) => String(s).padEnd(n);
  const r = (s, n) => String(s).padStart(n);
  const pad = Math.max(...report.map((x) => x.path.length), 4);
  console.log('');
  console.log(`  ${w('file', pad)}  ${r('bytes', 9)}  ${r('gzip', 8)}  cap`);
  console.log(`  ${'-'.repeat(pad)}  ${'-'.repeat(9)}  ${'-'.repeat(8)}  ${'-'.repeat(12)}`);
  for (const x of report) {
    const capTxt = x.cap ? `${x.cap} (${Math.round((100 * x.bytes) / x.cap)}%)` : '-';
    console.log(`  ${w(x.path, pad)}  ${r(x.bytes.toLocaleString('en-US'), 9)}  ${r(x.gzipBytes.toLocaleString('en-US'), 8)}  ${capTxt}`);
  }
  const tb = report.reduce((a, x) => a + x.bytes, 0);
  const tg = report.reduce((a, x) => a + x.gzipBytes, 0);
  console.log(`  ${'-'.repeat(pad)}  ${'-'.repeat(9)}  ${'-'.repeat(8)}`);
  console.log(`  ${w('total', pad)}  ${r(tb.toLocaleString('en-US'), 9)}  ${r(tg.toLocaleString('en-US'), 8)}`);
  console.log('');
}

// ---------------------------------------------------------------------------
// generated TypeScript + tests + credits
// ---------------------------------------------------------------------------

const GEN_HEADER = `// GENERATED by scripts/vendor-catalogs.mjs — do not edit by hand.
// Run \`npm run vendor:catalogs\` to regenerate.
`;

const INDEX_TS = `${GEN_HEADER}//
// Sky catalogs vendored from d3-celestial (BSD-3-Clause, (c) 2015 Olaf Frohn).
// All right ascensions are degrees in [0, 360); declinations are degrees in
// [-90, 90]. See CREDITS.md at the repo root.

import starsJson from './stars.json';
import constellationsJson from './constellations.json';
import messierJson from './messier.json';
import milkyWayJson from './milkyway.json';

export interface StarRecord {
  ra: number;
  dec: number;
  mag: number;
  /** B-V colour index; ${DEFAULT_BV} when the catalogue has no value. */
  bv: number;
  /** Proper name ("Vega", "Sirius", …) or "" when the star has none. */
  name: string;
  /** Hipparcos number, 0 when unknown. */
  hip: number;
}

export interface ConstellationRecord {
  /** 3-letter IAU abbreviation, e.g. "And". */
  id: string;
  name: string;
  /** Primary label position; the first entry of \`labels\`. */
  labelRa: number;
  labelDec: number;
  /**
   * Every label position for this constellation. One for all of them except
   * Serpens, whose two halves (Caput and Cauda) sit on opposite sides of
   * Ophiuchus and are labelled separately.
   */
  labels: [number, number][];
  /** Polylines already cut at the RA=0/360 seam. */
  lines: [number, number][][];
}

export type MessierType =
  | 'galaxy'
  | 'open_cluster'
  | 'globular_cluster'
  | 'planetary_nebula'
  | 'diffuse_nebula'
  | 'supernova_remnant'
  | 'other';

export interface MessierRecord {
  id: string;
  name: string;
  type: MessierType;
  ra: number;
  dec: number;
  mag: number | null;
  /** Largest dimension in arcminutes, null when the source size is unparseable. */
  sizeArcmin: number | null;
  /** 3-letter IAU constellation abbreviation. */
  con: string;
}

export interface MilkyWayLevel {
  /** "ol1" (faintest) … "ol5" (brightest). */
  id: string;
  /**
   * Rings to fill. Explicitly closed — the last vertex repeats the first, so a
   * stroked outline joins up too. NOT cut at the RA seam (see CREDITS.md).
   */
  polygons: [number, number][][];
}

type StarTuple = [number, number, number, number, string, number];

/** [ra, dec, mag, bv, name, hip], brightest first. */
export const STAR_TUPLES = starsJson.stars as StarTuple[];

/** Faintest magnitude present in STARS. */
export const STAR_MAG_LIMIT: number = starsJson.maxMag;

/**
 * Every catalogued star, brightest first — a renderer can take a prefix to
 * thin the sky. Expanded once, the first time this module is imported.
 */
export const STARS: StarRecord[] = STAR_TUPLES.map(([ra, dec, mag, bv, name, hip]) => ({
  ra,
  dec,
  mag,
  bv,
  name,
  hip,
}));

export const CONSTELLATIONS: ConstellationRecord[] =
  constellationsJson.constellations as ConstellationRecord[];

export const MESSIER: MessierRecord[] = messierJson.objects as MessierRecord[];

export const MILKY_WAY: MilkyWayLevel[] = milkyWayJson.levels as MilkyWayLevel[];

/** Lookup by Messier id ("M31"). */
export const MESSIER_BY_ID: ReadonlyMap<string, MessierRecord> = new Map(
  MESSIER.map((o) => [o.id, o]),
);

/** Lookup by IAU abbreviation ("And"). */
export const CONSTELLATION_BY_ID: ReadonlyMap<string, ConstellationRecord> = new Map(
  CONSTELLATIONS.map((c) => [c.id, c]),
);
`;

const TEST_TS = `${GEN_HEADER}
import { describe, expect, it } from 'vitest';
import {
  CONSTELLATIONS,
  MESSIER,
  MILKY_WAY,
  STARS,
  STAR_TUPLES,
  type MessierType,
} from './index';

const ALLOWED_TYPES: MessierType[] = [
  'galaxy',
  'open_cluster',
  'globular_cluster',
  'planetary_nebula',
  'diffuse_nebula',
  'supernova_remnant',
  'other',
];

const inRaRange = (ra: number) => Number.isFinite(ra) && ra >= 0 && ra < 360;
const inDecRange = (dec: number) => Number.isFinite(dec) && dec >= -90 && dec <= 90;

describe('stars', () => {
  it('has a usable number of stars', () => {
    expect(STARS.length).toBeGreaterThan(3000);
    expect(STAR_TUPLES.length).toBe(STARS.length);
  });

  it('keeps every coordinate in range', () => {
    for (const s of STARS) {
      expect(inRaRange(s.ra), \`ra out of range for HIP \${s.hip}: \${s.ra}\`).toBe(true);
      expect(inDecRange(s.dec), \`dec out of range for HIP \${s.hip}: \${s.dec}\`).toBe(true);
    }
  });

  it('is sorted by magnitude ascending', () => {
    for (let i = 1; i < STARS.length; i++) {
      expect(STARS[i].mag).toBeGreaterThanOrEqual(STARS[i - 1].mag);
    }
  });

  it('has a finite B-V for every star', () => {
    for (const s of STARS) expect(Number.isFinite(s.bv)).toBe(true);
  });

  it('keeps the proper names a planetarium needs', () => {
    const byName = new Map(STARS.filter((s) => s.name).map((s) => [s.name, s]));
    for (const n of ['Vega', 'Sirius', 'Polaris', 'Betelgeuse', 'Rigel']) {
      expect(byName.has(n), \`missing star name \${n}\`).toBe(true);
    }
    // Sirius is the brightest star in the sky, so it must sort first.
    expect(STARS[0].name).toBe('Sirius');
  });
});

describe('constellations', () => {
  it('ships the full IAU set', () => {
    expect(CONSTELLATIONS.length).toBeGreaterThanOrEqual(88);
    expect(new Set(CONSTELLATIONS.map((c) => c.id)).size).toBe(CONSTELLATIONS.length);
  });

  it('keeps every coordinate in range', () => {
    for (const c of CONSTELLATIONS) {
      expect(inRaRange(c.labelRa), \`label ra for \${c.id}\`).toBe(true);
      expect(inDecRange(c.labelDec), \`label dec for \${c.id}\`).toBe(true);
      for (const line of c.lines) {
        for (const [ra, dec] of line) {
          expect(inRaRange(ra), \`ra out of range in \${c.id}: \${ra}\`).toBe(true);
          expect(inDecRange(dec), \`dec out of range in \${c.id}: \${dec}\`).toBe(true);
        }
      }
    }
  });

  it('never jumps across the sky between two consecutive points', () => {
    for (const c of CONSTELLATIONS) {
      for (const line of c.lines) {
        expect(line.length).toBeGreaterThanOrEqual(2);
        for (let i = 1; i < line.length; i++) {
          const jump = Math.abs(line[i][0] - line[i - 1][0]);
          expect(jump, \`RA jump of \${jump} in \${c.id}\`).toBeLessThanOrEqual(180);
        }
      }
    }
  });

  it('has a name and at least one label for every constellation', () => {
    for (const c of CONSTELLATIONS) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.labels.length).toBeGreaterThanOrEqual(1);
      expect(c.labels[0]).toEqual([c.labelRa, c.labelDec]);
    }
    expect(CONSTELLATIONS.find((c) => c.id === 'Ori')?.name).toBe('Orion');
  });

  it('merges the two Serpens halves under the IAU name, keeping both labels', () => {
    const ser = CONSTELLATIONS.find((c) => c.id === 'Ser');
    expect(ser, 'Ser missing').toBeDefined();
    expect(ser!.name).toBe('Serpens');
    expect(ser!.labels.length).toBe(2);
    expect(ser!.lines.length).toBeGreaterThanOrEqual(2);
  });
});

describe('messier', () => {
  it('has exactly 110 objects, M1..M110', () => {
    expect(MESSIER.length).toBe(110);
    expect(MESSIER.map((o) => o.id)).toEqual(
      Array.from({ length: 110 }, (_, i) => \`M\${i + 1}\`),
    );
  });

  it('only uses the allowed types', () => {
    for (const o of MESSIER) {
      expect(ALLOWED_TYPES, \`\${o.id} has type \${o.type}\`).toContain(o.type);
    }
  });

  it('keeps every coordinate in range', () => {
    for (const o of MESSIER) {
      expect(inRaRange(o.ra), \`ra out of range for \${o.id}: \${o.ra}\`).toBe(true);
      expect(inDecRange(o.dec), \`dec out of range for \${o.id}: \${o.dec}\`).toBe(true);
    }
  });

  // J2000 positions from SIMBAD. M42 gets a wider tolerance because
  // d3-celestial's centroid for the Orion Nebula sits 3.6' south of the SIMBAD
  // position — inside a nebula 66' across. The other three pin the transform
  // to better than 0.01 deg.
  it('matches the golden coordinates', () => {
    const golden: Record<string, { ra: number; dec: number; tol: number }> = {
      M31: { ra: 10.685, dec: 41.269, tol: 0.05 },
      M42: { ra: 83.82, dec: -5.39, tol: 0.08 },
      M45: { ra: 56.75, dec: 24.12, tol: 0.05 },
      M13: { ra: 250.42, dec: 36.46, tol: 0.05 },
    };
    for (const [id, g] of Object.entries(golden)) {
      const o = MESSIER.find((x) => x.id === id);
      expect(o, \`\${id} missing\`).toBeDefined();
      expect(Math.abs(o!.ra - g.ra), \`\${id} ra\`).toBeLessThanOrEqual(g.tol);
      expect(Math.abs(o!.dec - g.dec), \`\${id} dec\`).toBeLessThanOrEqual(g.tol);
    }
  });

  it('places objects in the right constellation', () => {
    const expected: Record<string, string> = {
      M1: 'Tau',
      M13: 'Her',
      M27: 'Vul',
      M31: 'And',
      M42: 'Ori',
      M45: 'Tau',
      M51: 'CVn',
      M104: 'Vir',
    };
    for (const [id, con] of Object.entries(expected)) {
      expect(MESSIER.find((o) => o.id === id)?.con, id).toBe(con);
    }
    for (const o of MESSIER) expect(o.con).toMatch(/^[A-Za-z]{3}$/);
  });

  it('carries names and sizes', () => {
    for (const o of MESSIER) expect(o.name.length).toBeGreaterThan(0);
    expect(MESSIER.find((o) => o.id === 'M45')?.name).toBe('Pleiades');
    expect(MESSIER.find((o) => o.id === 'M31')?.sizeArcmin).toBe(190);
    for (const o of MESSIER) {
      if (o.sizeArcmin !== null) expect(o.sizeArcmin).toBeGreaterThan(0);
    }
  });
});

describe('milky way', () => {
  it('ships all five outline levels', () => {
    expect(MILKY_WAY.map((l) => l.id)).toEqual(['ol1', 'ol2', 'ol3', 'ol4', 'ol5']);
  });

  it('keeps every coordinate in range', () => {
    for (const level of MILKY_WAY) {
      expect(level.polygons.length).toBeGreaterThan(0);
      for (const ring of level.polygons) {
        expect(ring.length).toBeGreaterThanOrEqual(4);
        for (const [ra, dec] of ring) {
          expect(inRaRange(ra), \`ra out of range in \${level.id}: \${ra}\`).toBe(true);
          expect(inDecRange(dec), \`dec out of range in \${level.id}: \${dec}\`).toBe(true);
        }
      }
    }
  });

  it('closes every ring explicitly', () => {
    for (const level of MILKY_WAY) {
      for (const ring of level.polygons) {
        expect(ring[ring.length - 1], \`unclosed ring in \${level.id}\`).toEqual(ring[0]);
      }
    }
  });
});
`;

function creditsMd(meta) {
  return `# Credits

Roque Nights is built on public astronomical data and open-source libraries. This
file lists everything that ships inside the bundle, with its licence.

## Sky catalogs — d3-celestial

\`src/data/stars.json\`, \`src/data/constellations.json\`, \`src/data/messier.json\` and
\`src/data/milkyway.json\` are derived from the data files of
[d3-celestial](https://github.com/ofrohn/d3-celestial) by Olaf Frohn.

\`\`\`
BSD 3-Clause License

Copyright (c) 2015, Olaf Frohn
All rights reserved.
\`\`\`

Full licence text: <https://github.com/ofrohn/d3-celestial/blob/master/LICENSE>

Upstream files used:

| Upstream file | Used for |
|---|---|
| \`stars.6.json\` | star positions, magnitudes and B-V colour indices |
| \`starnames.json\` | proper star names ("Vega", "Sirius", …), keyed by Hipparcos number |
| \`constellations.lines.json\` | constellation stick figures |
| \`constellations.json\` | constellation names and label positions |
| \`constellations.borders.json\` | IAU boundaries, used to derive each Messier object's constellation |
| \`messier.json\` | the 110 Messier objects |
| \`mw.json\` | Milky Way isophote outlines (5 levels) |

d3-celestial itself credits the Hipparcos, Yale Bright Star and Gliese catalogues
for the stellar data, and the Messier/NGC catalogues for the deep-sky objects.

### What the vendoring step changes

- **Right ascension is normalised to \`[0, 360)\`.** Upstream ships RA wrapped to
  \`-180..180\` (the d3-geo convention).
- **Coordinates are rounded** — stars to 4 decimals, constellations to 3, Messier
  to 3, Milky Way to 2.
- **Stars** are flattened to \`[ra, dec, mag, bv, name, hip]\` tuples and sorted
  brightest-first, so a renderer can take a prefix. Magnitude cut: **${meta.magCut}**.
  ${meta.missingBv} star(s) with no B-V in the source get \`${DEFAULT_BV}\`.
- **Constellations**: the two Serpens features (Caput and Cauda) are merged into a
  single \`Ser\` record so every id is unique — named "Serpens" (the shared Latin
  name), keeping **both** label positions in \`labels\`, since the two halves sit on
  opposite sides of Ophiuchus. Polylines that cross the RA=0/360 seam are cut
  there, with the interpolated seam point repeated on both sides, so a renderer
  never draws a chord across the whole sky.
- **Messier**: the upstream file carries no constellation, so \`con\` is computed by
  ray-casting each object against \`constellations.borders.json\` (each border
  segment is tagged with the constellations it separates, so the segments tagged
  \`X\` are exactly \`X\`'s boundary — no stitching needed). Verified against the
  canonical Messier table. Upstream type codes are mapped explicitly to seven
  render categories; \`pos\` (M24 star cloud, M40 double star, M73 asterism) is the
  only code that lands on \`other\`.
  Positions are checked against SIMBAD for M31/M42/M45/M13 on every run. Note that
  d3-celestial puts M42 at dec −5.45 where SIMBAD says −5.391 — a 3.6′ difference
  in a nebula 66′ across, so the check allows 0.08° for that one object and 0.05°
  for the rest.
- **Milky Way**: ${meta.mwNote}

## Ephemerides — astronomy-engine

Sun, Moon and planet positions are computed in the browser with
[astronomy-engine](https://github.com/cosinekitty/astronomy) by Don Cross — MIT
licence.

\`\`\`
MIT License

Copyright (c) 2019-2025 Don Cross <cosinekitty@gmail.com>
\`\`\`

## Weather — Open-Meteo

Cloud cover and upper-air forecasts come from [Open-Meteo](https://open-meteo.com/),
used under CC BY 4.0. No API key, no account, attribution in the UI.

## Regenerating the catalogs

The JSON under \`src/data/\` is generated, not hand-edited. To rebuild it from
upstream:

\`\`\`sh
npm run vendor:catalogs
\`\`\`

which is exactly:

\`\`\`sh
node scripts/vendor-catalogs.mjs
\`\`\`

The script downloads the upstream files over HTTPS, rewrites
\`src/data/*.json\`, regenerates \`src/data/index.ts\` and \`src/data/catalog.test.ts\`,
refreshes this file, prints a size table, and **fails loudly** if a golden
coordinate check breaks or an output would exceed its size cap
(stars ${CAPS['stars.json'].toLocaleString('en-US')} B, Milky Way ${CAPS['milkyway.json'].toLocaleString('en-US')} B).

Verify with:

\`\`\`sh
npx vitest run src/data
npx tsc --noEmit -p tsconfig.app.json
\`\`\`
`;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  console.log(CACHE ? `reading upstream from ${CACHE}` : `fetching from ${BASE}`);
  const [starsGeo, starNames, conLines, conNames, conBorders, messierGeo, mwGeo] =
    await Promise.all([
      load(SOURCES.stars),
      load(SOURCES.starnames),
      load(SOURCES.conLines),
      load(SOURCES.conNames),
      load(SOURCES.conBorders),
      load(SOURCES.messier),
      load(SOURCES.mw),
    ]);

  const notes = [];

  // --- stars ---------------------------------------------------------------
  let magCut = 6.0;
  let stars = buildStars(starsGeo, starNames, magCut);
  let starDoc = {
    source: `d3-celestial ${SOURCES.stars}`,
    license: LICENSE,
    count: stars.rows.length,
    maxMag: magCut,
    stars: stars.rows,
  };
  let starBytes = Buffer.byteLength(JSON.stringify(starDoc) + '\n');
  if (starBytes > CAPS['stars.json']) {
    magCut = 5.5;
    notes.push(`mag<=6.0 would be ${starBytes} B (over the 220 kB cap) — cut lowered to 5.5`);
    stars = buildStars(starsGeo, starNames, magCut);
    starDoc = { ...starDoc, count: stars.rows.length, maxMag: magCut, stars: stars.rows };
  }
  emit('stars.json', starDoc);
  notes.push(
    `${stars.rows.length} stars at mag<=${magCut} (${stars.named} with a proper name from starnames.json; ${stars.missingBv} with no B-V, defaulted to ${DEFAULT_BV})`,
  );

  // --- constellations ------------------------------------------------------
  const con = buildConstellations(conLines, conNames);
  emit('constellations.json', {
    source: `d3-celestial ${SOURCES.conLines} + ${SOURCES.conNames}`,
    license: LICENSE,
    count: con.constellations.length,
    constellations: con.constellations,
  });
  notes.push(
    `${con.constellations.length} constellations from ${con.sourceFeatures} upstream features (the two Serpens features merged into one "Ser"); ${con.seamSplits} polyline(s) cut at the RA=0/360 seam`,
  );

  // --- messier -------------------------------------------------------------
  const locator = makeConstellationLocator(conBorders);
  const messier = buildMessier(messierGeo, locator);
  emit('messier.json', {
    source: `d3-celestial ${SOURCES.messier} (constellations derived from ${SOURCES.conBorders})`,
    license: LICENSE,
    count: messier.objects.length,
    objects: messier.objects,
  });
  notes.push(
    `110 Messier objects; constellations derived by ray-casting against ${locator.count} IAU boundaries; golden checks for M31/M42/M45/M13 passed`,
  );
  for (const g of messier.goldenNotes) notes.push(`golden: ${g}`);

  // --- milky way -----------------------------------------------------------
  let mw = null;
  let step = null;
  let mwBytes = 0;
  for (const s of MW_STEPS) {
    const built = buildMilkyWayAt(mwGeo, s.tol, s.minArea);
    const doc = {
      source: `d3-celestial ${SOURCES.mw}`,
      license: LICENSE,
      levels: built.levels,
    };
    const b = Buffer.byteLength(JSON.stringify(doc) + '\n');
    if (b <= CAPS['milkyway.json']) {
      mw = built;
      step = s;
      mwBytes = b;
      break;
    }
  }
  if (!mw) fail('could not simplify mw.json under the 120 kB cap with any configured tolerance');
  emit('milkyway.json', {
    source: `d3-celestial ${SOURCES.mw}`,
    license: LICENSE,
    levels: mw.levels,
  });
  const mwNote =
    `all 5 outline levels kept. Rings simplified with Douglas-Peucker at ` +
    `**${step.tol}°** tolerance (RA unwrapped first so the seam does not distort distances), ` +
    `rings smaller than **${step.minArea} deg²** dropped, coordinates rounded to 2 decimals: ` +
    `${mw.ptsIn.toLocaleString('en-US')} → ${mw.ptsOut.toLocaleString('en-US')} points, ` +
    `${mw.ringsIn} → ${mw.ringsOut} rings (point counts include each ring's repeated closing ` +
    `vertex, on both sides). Rings are **explicitly closed** — the last vertex repeats the ` +
    `first, so a stroked outline joins up — and **not cut at the RA seam**: ` +
    `they are fill polygons, and cutting them would break the fill. The renderer must project ` +
    `each vertex independently (a whole-sky stereographic dome has no seam at RA=0); ` +
    `${mw.wrapRings} ring(s) cross it.`;
  notes.push(
    `milky way: DP tol ${step.tol}deg, min ring area ${step.minArea} deg2, ${mw.ptsIn}->${mw.ptsOut} points, ${mw.ringsIn}->${mw.ringsOut} rings, ${mwBytes} B`,
  );

  // --- generated TS + tests + credits -------------------------------------
  emitText(join(OUT_DIR, 'index.ts'), INDEX_TS);
  emitText(join(OUT_DIR, 'catalog.test.ts'), TEST_TS);
  emitText(
    join(ROOT, 'CREDITS.md'),
    creditsMd({ magCut, missingBv: stars.missingBv, mwNote }),
  );

  printTable();
  console.log('  type mapping:', JSON.stringify(messier.typeMapping));
  console.log('  "other":', messier.otherIds.join(', ') || '(none)');
  for (const n of notes) console.log('  -', n);
  console.log('');
  if (DRY) console.log('  (--dry: nothing was written)\n');

  // machine-readable summary for the caller
  console.log(
    'SUMMARY ' +
      JSON.stringify({
        files: report.map(({ path, bytes, gzipBytes }) => ({ path, bytes, gzipBytes })),
        starCount: stars.rows.length,
        magCut,
        constellationCount: con.constellations.length,
        messierTypeMapping: messier.typeMapping,
        otherIds: messier.otherIds,
        milkyWay: { tol: step.tol, minArea: step.minArea, points: mw.ptsOut, rings: mw.ringsOut },
      }),
  );
}

main().catch((err) => {
  console.error('\nvendor-catalogs FAILED:', err.message);
  process.exitCode = 1;
});
