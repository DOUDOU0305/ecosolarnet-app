const WEATHER_CODES = {
  0: "ciel dégagé",
  1: "plutôt dégagé",
  2: "partiellement nuageux",
  3: "couvert",
  45: "brouillard",
  48: "brouillard givrant",
  51: "bruine légère",
  53: "bruine",
  55: "bruine forte",
  56: "bruine verglaçante",
  57: "bruine verglaçante forte",
  61: "pluie légère",
  63: "pluie",
  65: "forte pluie",
  66: "pluie verglaçante",
  67: "pluie verglaçante forte",
  71: "neige légère",
  73: "neige",
  75: "forte neige",
  77: "grains de neige",
  80: "averses légères",
  81: "averses",
  82: "fortes averses",
  85: "averses de neige légères",
  86: "averses de neige",
  95: "orage",
  96: "orage avec grêle",
  99: "orage violent avec grêle",
};

const RAIN_SNOW_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]);
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);

let cache = null; // { at, key, data }
const CACHE_TTL_MS = 15 * 60 * 1000;

export async function getWeatherSummary(lat, lng) {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=precipitation,weathercode&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=auto&forecast_days=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Météo indisponible");
  const data = await res.json();
  const summary = buildSummary(data);
  cache = { at: Date.now(), key, data: summary };
  return summary;
}

function buildSummary(data) {
  const dailyCode = data.daily.weathercode[0];
  const tMax = Math.round(data.daily.temperature_2m_max[0]);
  const tMin = Math.round(data.daily.temperature_2m_min[0]);
  const desc = WEATHER_CODES[dailyCode] || "";

  const now = new Date();
  const currentHour = now.getHours();
  const times = data.hourly.time || [];
  const codes = data.hourly.weathercode || [];
  const precip = data.hourly.precipitation || [];

  let alert = null;
  for (let i = 0; i < times.length; i++) {
    const hour = new Date(times[i]).getHours();
    if (hour < currentHour) continue;
    if (RAIN_SNOW_CODES.has(codes[i]) || precip[i] >= 0.2) {
      alert = { hour, isSnow: SNOW_CODES.has(codes[i]) };
      break;
    }
  }

  let text = `Aujourd'hui : ${desc}, ${tMin}° à ${tMax}°.`;
  if (alert) {
    text += ` ${alert.isSnow ? "❄️ Neige" : "🌧️ Pluie"} prévue vers ${String(alert.hour).padStart(2, "0")}h.`;
  }
  return { text };
}
