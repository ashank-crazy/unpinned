export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** EXIF dates are wall-clock times without a zone; exifr builds them as local Dates, so local getters return them unchanged. */
export function formatDateTime(date: Date): string {
  return date.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatOffset(offset: string): string {
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(offset.trim());
  if (!match) return offset;
  const [, sign, hours, minutes] = match;
  return `UTC${sign === '-' ? '−' : '+'}${hours}:${minutes}`;
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

export function compassDirection(degrees: number): string {
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return COMPASS[index];
}

export function formatMeters(meters: number): string {
  const feet = Math.round(meters * 3.281);
  if (meters < 10) return `${meters.toFixed(1).replace(/\.0$/, '')} m (${feet} ft)`;
  return `${Math.round(meters)} m (${feet.toLocaleString('en-US')} ft)`;
}

export function formatKilometers(km: number): string {
  const miles = km * 0.621371;
  const round = (value: number) => (value < 10 ? value.toFixed(1).replace(/\.0$/, '') : String(Math.round(value)));
  return `${round(km)} km (${round(miles)} mi)`;
}

export function formatCoordinate(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Shortens long untrusted strings for display, keeping the start. */
export function clip(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
