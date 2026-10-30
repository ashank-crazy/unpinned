// Names the nearest town to a GPS position using a bundled list, so a photo's
// location is never sent to a map or geocoding service.

import { formatKilometers } from './format';

export interface PlaceTable {
  names: string[];
  countries: string[];
  states: string[];
  lats: Float64Array;
  lons: Float64Array;
}

export interface NearestPlace {
  name: string;
  state: string;
  country: string;
  distanceKm: number;
}

let tablePromise: Promise<PlaceTable> | null = null;

export function parsePlaces(text: string): PlaceTable {
  const rows = text.split('\n').filter((line) => line && !line.startsWith('#'));
  const table: PlaceTable = {
    names: [],
    countries: [],
    states: [],
    lats: new Float64Array(rows.length),
    lons: new Float64Array(rows.length),
  };
  rows.forEach((row, index) => {
    const [name, country, state, lat, lon] = row.split('\t');
    table.names.push(name);
    table.countries.push(country);
    table.states.push(state);
    table.lats[index] = Number(lat);
    table.lons[index] = Number(lon);
  });
  return table;
}

function loadPlaces(): Promise<PlaceTable> {
  tablePromise ??= import('../data/places.txt?raw').then((module) => parsePlaces(module.default));
  return tablePromise;
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function nearestIn(table: PlaceTable, lat: number, lon: number): NearestPlace | null {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < table.names.length; i++) {
    // Cheap rejection before the exact distance: one degree of latitude is about 111 km.
    if (Math.abs(table.lats[i] - lat) * 111 > bestDistance) continue;
    const d = distanceKm(lat, lon, table.lats[i], table.lons[i]);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  if (best < 0) return null;
  return {
    name: table.names[best],
    state: table.states[best],
    country: countryName(table.countries[best]),
    distanceKm: bestDistance,
  };
}

export async function nearestPlace(lat: number, lon: number): Promise<NearestPlace | null> {
  try {
    return nearestIn(await loadPlaces(), lat, lon);
  } catch {
    return null;
  }
}

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** "in or near Chicago, IL, United States", worded honestly for how far away the town is. */
export function describePlace(place: NearestPlace): string {
  const label = [place.name, place.state, place.country].filter(Boolean).join(', ');
  if (place.distanceKm < 12) return `in or near ${label}`;
  if (place.distanceKm < 80) return `about ${formatKilometers(place.distanceKm)} from ${label}`;
  return `far from large towns; the nearest is ${label}, ${formatKilometers(place.distanceKm)} away`;
}
