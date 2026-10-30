// Builds src/data/places.txt: towns of 15,000+ people from GeoNames (via the
// all-the-cities package), used to name the nearest town to a photo's GPS
// position without any network request. Run: node scripts/build-places.mjs
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const cities = require('all-the-cities');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Skip neighborhoods (PPLX) and historical or abandoned places, so names read like towns.
const SKIP_CODES = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH']);

const rows = cities
  .filter((city) => city.population >= 15000 && !SKIP_CODES.has(city.featureCode))
  .sort((a, b) => b.population - a.population)
  .map((city) => {
    const [lon, lat] = city.loc.coordinates;
    // US state codes read well ("Chicago, IL"); other countries' admin codes are numeric.
    const admin = city.country === 'US' ? city.adminCode : '';
    const name = city.name.replace(/[\t\n]/g, ' ');
    return `${name}\t${city.country}\t${admin}\t${lat.toFixed(2)}\t${lon.toFixed(2)}`;
  });

const header = '# Towns with 15,000+ people. Data: GeoNames (CC BY 4.0) via all-the-cities. name, country, US state, lat, lon\n';
await writeFile(join(root, 'src', 'data', 'places.txt'), header + rows.join('\n') + '\n');
console.log(`Wrote ${rows.length} places.`);
