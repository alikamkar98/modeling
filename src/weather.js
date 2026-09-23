// Live conditions from Open-Meteo — no API key, CORS-open, so the app stays a
// static page with no backend.

export const LINZ = { id: 'linz', name: 'Linz', latitude: 48.3069, longitude: 14.2858, timezone: 'Europe/Vienna' };
export const VIENNA = { id: 'vienna', name: 'Vienna', latitude: 48.2082, longitude: 16.3738, timezone: 'Europe/Vienna' };
export const PLACES = { linz: LINZ, vienna: VIENNA };

// Monthly climate normals (average daily high / low in °C, and the share of
// days with rain). Used when a trip is too far out for a forecast, or when the
// live service can't be reached — an honest average beats a guess.
const CLIMATE = {
  linz: {
    high: [2, 4, 10, 15, 20, 23, 25, 25, 20, 14, 7, 3],
    low: [-3, -3, 1, 4, 9, 12, 14, 14, 10, 6, 1, -2],
    wet: [0.3, 0.28, 0.32, 0.33, 0.4, 0.43, 0.42, 0.38, 0.32, 0.3, 0.33, 0.33],
  },
  vienna: {
    high: [3, 5, 10, 16, 21, 24, 26, 26, 21, 15, 8, 4],
    low: [-2, -1, 2, 6, 11, 14, 16, 16, 12, 7, 3, -1],
    wet: [0.26, 0.25, 0.28, 0.27, 0.33, 0.35, 0.33, 0.3, 0.28, 0.25, 0.28, 0.28],
  },
};

// Conditions actually looked up by hand for a trip, keyed by place and date.
// These beat the climate average for their day.
export const CHECKED = {
  'vienna:2026-09-23': { high: 18, low: 11, code: 3, windSpeed: 20, precipitationProbability: 10,
    note: 'checked 23 Sep: cloudy, 11–18°C, dry, light wind' },
};

/** A trip's conditions from climate normals (or a checked day), no network. */
export function climateWeather(place = LINZ, dateStr = new Date().toISOString().slice(0, 10)) {
  const checked = CHECKED[`${place.id}:${dateStr}`];
  const m = new Date(`${dateStr}T12:00:00`).getMonth();
  const c = CLIMATE[place.id] ?? CLIMATE.linz;
  const high = checked?.high ?? c.high[m];
  const low = checked?.low ?? c.low[m];
  // Dress for the day you are out in: weighted toward the high, not the
  // midpoint, but a cool morning still counts.
  const t = Math.round(low + (high - low) * 0.65);
  const wetChance = checked?.precipitationProbability ?? Math.round(c.wet[m] * 100);
  return {
    temperature: t,
    feelsLike: t - 1,
    precipitation: 0,
    precipitationProbability: wetChance,
    windSpeed: checked?.windSpeed ?? 12,
    code: checked?.code ?? 2,
    description: checked ? checked.note : `typical for ${dateLabel(dateStr)}`,
    high, low,
    place: place.name,
    date: dateStr,
    source: checked ? 'checked' : 'climate',
    fetchedAt: new Date().toISOString(),
  };
}

function dateLabel(dateStr) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

const WMO = {
  0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain',
  66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers',
  85: 'snow showers', 86: 'heavy snow showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail',
};

const WET_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);

export function describeCode(code) {
  return WMO[code] ?? 'unknown conditions';
}

/**
 * Turn raw conditions into the constraints the outfit engine actually needs.
 *
 * Warmth is a 1-5 scale matching the wardrobe catalog, expressed as a band
 * rather than a single number so a set can be assembled from layers.
 */
export function requirementsFrom(weather) {
  const t = weather.feelsLike;

  let warmth;
  if (t >= 26) warmth = { min: 1, max: 1, label: 'hot' };
  else if (t >= 20) warmth = { min: 1, max: 2, label: 'warm' };
  else if (t >= 14) warmth = { min: 2, max: 3, label: 'mild' };
  else if (t >= 7) warmth = { min: 3, max: 4, label: 'cool' };
  else if (t >= 0) warmth = { min: 4, max: 5, label: 'cold' };
  else warmth = { min: 5, max: 5, label: 'freezing' };

  const likelyWet = weather.precipitationProbability >= 40
    || weather.precipitation > 0
    || WET_CODES.has(weather.code);

  return {
    warmth,
    needsRainProtection: likelyWet,
    needsSnowFootwear: SNOW_CODES.has(weather.code),
    // Wind strips warmth faster than the thermometer suggests, so it earns an
    // outer layer in its own right.
    needsWindLayer: weather.windSpeed >= 25 && t < 20,
    // Below this (a Linz September morning), bare legs and open shoes stop being reasonable whatever the
    // occasion asks for.
    coverLegs: t < 16,
    coldLegs: t < 10,
  };
}

function normalise(json, place = LINZ, dateStr = null) {
  const d = json.daily ?? {};
  if (dateStr) {
    // A future day: no "current", so dress for the day's range.
    const hi = d.temperature_2m_max?.[0], lo = d.temperature_2m_min?.[0];
    const t = Math.round(lo + (hi - lo) * 0.65);
    const code = d.weather_code?.[0] ?? 0;
    return {
      temperature: t, feelsLike: t - 1, precipitation: d.precipitation_sum?.[0] ?? 0,
      precipitationProbability: d.precipitation_probability_max?.[0] ?? 0,
      windSpeed: d.wind_speed_10m_max?.[0] ?? 0, code, description: describeCode(code),
      high: hi, low: lo, place: place.name, date: dateStr, source: 'forecast',
      fetchedAt: new Date().toISOString(),
    };
  }
  const c = json.current ?? {};
  return {
    temperature: c.temperature_2m,
    feelsLike: c.apparent_temperature ?? c.temperature_2m,
    precipitation: c.precipitation ?? 0,
    precipitationProbability: d.precipitation_probability_max?.[0] ?? 0,
    windSpeed: c.wind_speed_10m ?? 0,
    code: c.weather_code ?? 0,
    description: describeCode(c.weather_code ?? 0),
    high: d.temperature_2m_max?.[0],
    low: d.temperature_2m_min?.[0],
    place: place.name,
    source: 'live',
    fetchedAt: new Date().toISOString(),
  };
}

export function buildUrl(place = LINZ, dateStr = null) {
  if (dateStr) {
    return `https://api.open-meteo.com/v1/forecast?${new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,weather_code,wind_speed_10m_max',
      timezone: place.timezone,
      start_date: dateStr,
      end_date: dateStr,
    })}`;
  }
  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: 'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: place.timezone,
    forecast_days: '1',
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

/**
 * Fetch current conditions. On any failure this throws rather than inventing a
 * fallback — the caller decides what to tell the user, because silently
 * guessing the weather would produce confidently wrong outfits.
 */
export async function fetchWeather(place = LINZ, { date = null, timeoutMs = 8000, fetchImpl = globalThis.fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(buildUrl(place, date), { signal: controller.signal });
    if (!res.ok) throw new Error(`weather service returned ${res.status}`);
    return normalise(await res.json(), place, date);
  } finally {
    clearTimeout(timer);
  }
}

// Used only when the live call fails and the user picks a rough temperature by
// hand. Flagged as `manual` so the UI can say so plainly.
export function manualWeather(label, place = LINZ) {
  const presets = {
    cold: { temperature: 2, feelsLike: 0, code: 3 },
    cool: { temperature: 10, feelsLike: 9, code: 3 },
    mild: { temperature: 17, feelsLike: 17, code: 2 },
    warm: { temperature: 23, feelsLike: 23, code: 1 },
    hot: { temperature: 30, feelsLike: 31, code: 0 },
  };
  const p = presets[label] ?? presets.mild;
  return {
    ...p,
    precipitation: 0,
    precipitationProbability: 0,
    windSpeed: 5,
    description: `${label} (set by hand)`,
    high: p.temperature,
    low: p.temperature,
    place: place.name,
    source: 'manual',
    fetchedAt: new Date().toISOString(),
  };
}
