# Credits

Roque Nights is built on public astronomical data and open-source libraries. This
file lists everything that ships inside the bundle, with its licence.

## Sky catalogs — d3-celestial

`src/data/stars.json`, `src/data/constellations.json`, `src/data/messier.json` and
`src/data/milkyway.json` are derived from the data files of
[d3-celestial](https://github.com/ofrohn/d3-celestial) by Olaf Frohn.

```
BSD 3-Clause License

Copyright (c) 2015, Olaf Frohn
All rights reserved.
```

Full licence text: <https://github.com/ofrohn/d3-celestial/blob/master/LICENSE>

Upstream files used:

| Upstream file | Used for |
|---|---|
| `stars.6.json` | star positions, magnitudes and B-V colour indices |
| `starnames.json` | proper star names ("Vega", "Sirius", …), keyed by Hipparcos number |
| `constellations.lines.json` | constellation stick figures |
| `constellations.json` | constellation names and label positions |
| `constellations.borders.json` | IAU boundaries, used to derive each Messier object's constellation |
| `messier.json` | the 110 Messier objects |
| `mw.json` | Milky Way isophote outlines (5 levels) |

d3-celestial itself credits the Hipparcos, Yale Bright Star and Gliese catalogues
for the stellar data, and the Messier/NGC catalogues for the deep-sky objects.

### What the vendoring step changes

- **Right ascension is normalised to `[0, 360)`.** Upstream ships RA wrapped to
  `-180..180` (the d3-geo convention).
- **Coordinates are rounded** — stars to 4 decimals, constellations to 3, Messier
  to 3, Milky Way to 2.
- **Stars** are flattened to `[ra, dec, mag, bv, name, hip]` tuples and sorted
  brightest-first, so a renderer can take a prefix. Magnitude cut: **6**.
  2 star(s) with no B-V in the source get `0.65`.
- **Constellations**: the two Serpens features (Caput and Cauda) are merged into a
  single `Ser` record so every id is unique — named "Serpens" (the shared Latin
  name), keeping **both** label positions in `labels`, since the two halves sit on
  opposite sides of Ophiuchus. Polylines that cross the RA=0/360 seam are cut
  there, with the interpolated seam point repeated on both sides, so a renderer
  never draws a chord across the whole sky.
- **Messier**: the upstream file carries no constellation, so `con` is computed by
  ray-casting each object against `constellations.borders.json` (each border
  segment is tagged with the constellations it separates, so the segments tagged
  `X` are exactly `X`'s boundary — no stitching needed). Verified against the
  canonical Messier table. Upstream type codes are mapped explicitly to seven
  render categories; `pos` (M24 star cloud, M40 double star, M73 asterism) is the
  only code that lands on `other`.
  Positions are checked against SIMBAD for M31/M42/M45/M13 on every run. Note that
  d3-celestial puts M42 at dec −5.45 where SIMBAD says −5.391 — a 3.6′ difference
  in a nebula 66′ across, so the check allows 0.08° for that one object and 0.05°
  for the rest.
- **Milky Way**: all 5 outline levels kept. Rings simplified with Douglas-Peucker at **0.1°** tolerance (RA unwrapped first so the seam does not distort distances), rings smaller than **0.3 deg²** dropped, coordinates rounded to 2 decimals: 30,676 → 5,332 points, 202 → 161 rings (point counts include each ring's repeated closing vertex, on both sides). Rings are **explicitly closed** — the last vertex repeats the first, so a stroked outline joins up — and **not cut at the RA seam**: they are fill polygons, and cutting them would break the fill. The renderer must project each vertex independently (a whole-sky stereographic dome has no seam at RA=0); 3 ring(s) cross it.

## Ephemerides — astronomy-engine

Sun, Moon and planet positions are computed in the browser with
[astronomy-engine](https://github.com/cosinekitty/astronomy) by Don Cross — MIT
licence.

```
MIT License

Copyright (c) 2019-2025 Don Cross <cosinekitty@gmail.com>
```

## Weather — Open-Meteo

Cloud cover and upper-air forecasts come from [Open-Meteo](https://open-meteo.com/),
used under CC BY 4.0. No API key, no account, attribution in the UI.

## Regenerating the catalogs

The JSON under `src/data/` is generated, not hand-edited. To rebuild it from
upstream:

```sh
npm run vendor:catalogs
```

which is exactly:

```sh
node scripts/vendor-catalogs.mjs
```

The script downloads the upstream files over HTTPS, rewrites
`src/data/*.json`, regenerates `src/data/index.ts` and `src/data/catalog.test.ts`,
refreshes this file, prints a size table, and **fails loudly** if a golden
coordinate check breaks or an output would exceed its size cap
(stars 220,000 B, Milky Way 120,000 B).

Verify with:

```sh
npx vitest run src/data
npx tsc --noEmit -p tsconfig.app.json
```
