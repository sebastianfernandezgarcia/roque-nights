// Sanity check of the astronomy math for the Roque, printed to the console.
// Run: node scripts/smoke.cjs [YYYY-MM-DD]
const A = require('astronomy-engine')

const nightOf = process.argv[2] ?? '2026-09-02'
const observer = new A.Observer(28.7542, -17.8851, 2396)
const searchStart = new Date(Date.parse(`${nightOf}T12:00:00Z`) - (-17.8851 / 15) * 3600000)

const sunset = A.SearchRiseSet(A.Body.Sun, observer, -1, searchStart, 1)
const dusk = A.SearchAltitude(A.Body.Sun, observer, -1, searchStart, 1, -18)
const dawn = A.SearchAltitude(A.Body.Sun, observer, +1, dusk.date, 1, -18)
const moonrise = A.SearchRiseSet(A.Body.Moon, observer, +1, searchStart, 1.2)
const moonset = A.SearchRiseSet(A.Body.Moon, observer, -1, searchStart, 1.2)
const illum = A.Illumination(A.Body.Moon, dusk.date)

console.log(`Night of ${nightOf} @ Roque de los Muchachos (UTC times)`)
console.log('  sunset          ', sunset.date.toISOString())
console.log('  astro darkness  ', dusk.date.toISOString(), '→', dawn.date.toISOString())
console.log('  dark hours      ', ((dawn.date - dusk.date) / 3600000).toFixed(2))
console.log('  moonrise        ', moonrise ? moonrise.date.toISOString() : 'none in window')
console.log('  moonset         ', moonset ? moonset.date.toISOString() : 'none in window')
console.log('  moon illum      ', (illum.phase_fraction * 100).toFixed(1) + '%')

// RA units trap check (astronomy-engine expects HOURS): M31 alt from the Roque
// at 01:00 UTC the following morning should be strongly positive (~60 deg).
const t = new Date(Date.parse(`${nightOf}T12:00:00Z`) + 13 * 3600000)
const m31RaHours = ((10.6847 + 360) % 360) / 15 // catalog RA in degrees → hours
const hor = A.Horizon(t, observer, m31RaHours, 41.269, 'normal')
console.log('  M31 alt @ +13h  ', hor.altitude.toFixed(1) + '° (must be positive and high)')
