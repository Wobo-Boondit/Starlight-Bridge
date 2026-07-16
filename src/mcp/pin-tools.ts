/**
 * Pin-equivalent tools exposed to Hermes over MCP.
 *
 * These mirror PenumbraOS native tools (weather, reverse_geocode, nearby_search)
 * but execute on the bridge so Hermes can call them while the Pin stays dumb.
 *
 * Free public APIs — no PirateWeather key required on the Optiplex.
 */

import type { RegisteredTool } from "./store.js";

const USER_AGENT = "starlight-bridge/0.1 (penumbra-pin-tools; contact: wobo@boondit.site)";

async function fetchJson(url: string): Promise<unknown> {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} for ${url}`);
  }
  return resp.json();
}

function num(v: unknown, name: string): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`Missing or invalid number: ${name}`);
  }
  return n;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** Open-Meteo current weather (no API key). */
async function weatherHandler(args: Record<string, unknown>): Promise<unknown> {
  const latitude = num(args.latitude, "latitude");
  const longitude = num(args.longitude, "longitude");
  const requestType = str(args.request_type, "current");
  const units = str(args.units, "fahrenheit");
  const tempUnit = units === "celsius" ? "celsius" : "fahrenheit";

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
    `&temperature_unit=${tempUnit}&wind_speed_unit=mph&timezone=auto&forecast_days=5`;

  const data = (await fetchJson(url)) as {
    current?: Record<string, unknown>;
    daily?: Record<string, unknown[]>;
    timezone?: string;
  };

  const current = data.current ?? {};
  const daily = data.daily ?? {};

  if (requestType === "alerts") {
    return {
      latitude,
      longitude,
      request_type: "alerts",
      alerts: [],
      note: "Open-Meteo free endpoint does not provide alerts; use NWS for US alerts if needed.",
    };
  }

  const forecastDays: Array<Record<string, unknown>> = [];
  const times = (daily.time as string[] | undefined) ?? [];
  for (let i = 0; i < times.length; i++) {
    forecastDays.push({
      date: times[i],
      high: daily.temperature_2m_max?.[i],
      low: daily.temperature_2m_min?.[i],
      precip_chance: daily.precipitation_probability_max?.[i],
      weather_code: daily.weather_code?.[i],
    });
  }

  return {
    latitude,
    longitude,
    timezone: data.timezone,
    request_type: requestType,
    units: tempUnit,
    current: {
      temperature: current.temperature_2m,
      feels_like: current.apparent_temperature,
      humidity: current.relative_humidity_2m,
      wind_speed_mph: current.wind_speed_10m,
      precipitation: current.precipitation,
      weather_code: current.weather_code,
      summary: weatherCodeToSummary(Number(current.weather_code ?? 0)),
    },
    daily: requestType === "current" ? [] : forecastDays,
  };
}

function weatherCodeToSummary(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 3) return "Partly cloudy";
  if (code <= 48) return "Foggy";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Rain showers";
  if (code <= 86) return "Snow showers";
  if (code >= 95) return "Thunderstorm";
  return `Weather code ${code}`;
}

/** OpenStreetMap Nominatim reverse geocode. */
async function reverseGeocodeHandler(args: Record<string, unknown>): Promise<unknown> {
  const latitude = num(args.latitude, "latitude");
  const longitude = num(args.longitude, "longitude");
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=16&addressdetails=1`;
  const data = (await fetchJson(url)) as {
    display_name?: string;
    name?: string;
    address?: Record<string, string>;
  };
  const address = data.address ?? {};
  return {
    latitude,
    longitude,
    display_name: data.display_name ?? null,
    name: data.name ?? null,
    city: address.city ?? address.town ?? address.village ?? address.hamlet ?? null,
    state: address.state ?? null,
    country: address.country ?? null,
    postcode: address.postcode ?? null,
    address,
  };
}

/** Overpass nearby places search. */
async function nearbySearchHandler(args: Record<string, unknown>): Promise<unknown> {
  const latitude = num(args.latitude, "latitude");
  const longitude = num(args.longitude, "longitude");
  const radius = Math.min(Math.max(Number(args.radius_meters ?? 1000) || 1000, 50), 5000);
  const query = str(args.query, "").trim();

  // Prefer amenity/shop/tourism with optional name filter
  const nameFilter = query
    ? `["name"~"${query.replace(/"/g, "")}",i]`
    : "";
  const overpass =
    `[out:json][timeout:15];(` +
    `node["amenity"]${nameFilter}(around:${radius},${latitude},${longitude});` +
    `node["shop"]${nameFilter}(around:${radius},${latitude},${longitude});` +
    `node["tourism"]${nameFilter}(around:${radius},${latitude},${longitude});` +
    `);out body 10;`;

  const resp = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `data=${encodeURIComponent(overpass)}`,
  });
  if (!resp.ok) {
    throw new Error(`Overpass HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as {
    elements?: Array<{
      lat?: number;
      lon?: number;
      tags?: Record<string, string>;
    }>;
  };

  const places = (data.elements ?? [])
    .filter((e) => e.lat != null && e.lon != null)
    .slice(0, 8)
    .map((e) => {
      const tags = e.tags ?? {};
      const streetParts = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean);
      const address =
        tags["addr:full"] ?? (streetParts.length > 0 ? streetParts.join(" ") : null);
      return {
        name: tags.name ?? tags.amenity ?? tags.shop ?? tags.tourism ?? "Unknown",
        description: tags.amenity ?? tags.shop ?? tags.tourism ?? null,
        address,
        latitude: e.lat,
        longitude: e.lon,
        website_url: tags.website ?? tags.url ?? null,
      };
    });

  return { places, query: query || null, radius_meters: radius, latitude, longitude };
}

/** Build the pin tool set for MCP registration. */
export function buildPinTools(): RegisteredTool[] {
  return [
    {
      name: "weather",
      description:
        "Get weather for a latitude and longitude, including current conditions and daily forecasts. Use current for now, forecast for later today/this week. Coordinates are usually available from the user status context.",
      inputSchema: {
        type: "object",
        properties: {
          latitude: { type: "number", description: "Latitude for the weather location. Required." },
          longitude: { type: "number", description: "Longitude for the weather location. Required." },
          request_type: {
            type: "string",
            enum: ["current", "forecast", "historical", "alerts"],
            description: "current | forecast | historical | alerts",
          },
          time: {
            type: "string",
            description: "Optional ISO 8601 for historical only.",
          },
          units: {
            type: "string",
            enum: ["fahrenheit", "celsius"],
            description: "Temperature units. Defaults to fahrenheit.",
          },
        },
        required: ["latitude", "longitude", "request_type"],
      },
      handler: weatherHandler,
    },
    {
      name: "reverse_geocode",
      description:
        "Look up the human-readable address or place name for latitude and longitude. Use for where am I / what city am I in.",
      inputSchema: {
        type: "object",
        properties: {
          latitude: { type: "number", description: "Latitude to reverse geocode." },
          longitude: { type: "number", description: "Longitude to reverse geocode." },
        },
        required: ["latitude", "longitude"],
      },
      handler: reverseGeocodeHandler,
    },
    {
      name: "nearby_search",
      description:
        "Search for nearby places (amenities, shops, tourism) around coordinates. Optional free-text query.",
      inputSchema: {
        type: "object",
        properties: {
          latitude: { type: "number" },
          longitude: { type: "number" },
          radius_meters: { type: "number", description: "Search radius in meters (default 1000)." },
          query: { type: "string", description: "Optional place name / category filter." },
        },
        required: ["latitude", "longitude"],
      },
      handler: nearbySearchHandler,
    },
  ];
}
