const { CORS_HEADERS, jsonResponse } = require("./_utils");

const LAT = "59.1248";
const LON = "11.3875";

function symbolToText(symbol = "") {
  if (!symbol) return "Værdata hentet";
  if (symbol.includes("clearsky")) return "Klart";
  if (symbol.includes("fair")) return "Lettskyet";
  if (symbol.includes("partlycloudy")) return "Delvis skyet";
  if (symbol.includes("cloudy")) return "Skyet";
  if (symbol.includes("rain")) return "Regn";
  if (symbol.includes("sleet")) return "Sludd";
  if (symbol.includes("snow")) return "Snø";
  if (symbol.includes("fog")) return "Tåke";
  return symbol.replaceAll("_", " ");
}

function osloTime(value = "") {
  if (!value) return "--:--";

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "--:--";

  return d.toLocaleTimeString("no-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo"
  });
}

function todayOsloDate() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function pickNextHour(first = {}) {
  return (
    first?.data?.next_1_hours ||
    first?.data?.next_6_hours ||
    first?.data?.next_12_hours ||
    {}
  );
}

async function getForecast() {
  const res = await fetch(
    `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${LAT}&lon=${LON}`,
    {
      headers: {
        "User-Agent": "HaldenNaa/1.0 kontakt: redaksjon@halden-naa.no",
        "Accept": "application/json"
      }
    }
  );

  if (!res.ok) throw new Error(`MET locationforecast svarte ${res.status}`);

  const data = await res.json();
  const first = data?.properties?.timeseries?.[0];
  const details = first?.data?.instant?.details || {};
  const next = pickNextHour(first);

  return {
    updatedAt: data?.properties?.meta?.updated_at || new Date().toISOString(),
    temperature: Math.round(details.air_temperature),
    feelsLike: Math.round(
      details.air_temperature_apparent ?? details.air_temperature
    ),
    wind: Math.round(details.wind_speed ?? 0),
    rain: Number(next?.details?.precipitation_amount ?? 0),
    description: symbolToText(next?.summary?.symbol_code || ""),
    symbol: next?.summary?.symbol_code || ""
  };
}

async function getSun() {
  const date = todayOsloDate();

  const res = await fetch(
    `https://api.met.no/weatherapi/sunrise/3.0/sun?lat=${LAT}&lon=${LON}&date=${date}&offset=%2B02:00`,
    {
      headers: {
        "User-Agent": "HaldenNaa/1.0 kontakt: redaksjon@halden-naa.no",
        "Accept": "application/json"
      }
    }
  );

  if (!res.ok) throw new Error(`MET sunrise svarte ${res.status}`);

  const data = await res.json();
  const props = data?.properties || {};

  return {
    sunrise: osloTime(props?.sunrise?.time),
    sunset: osloTime(props?.sunset?.time)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  try {
    const [forecast, sun] = await Promise.allSettled([
      getForecast(),
      getSun()
    ]);

    if (forecast.status !== "fulfilled") {
      throw forecast.reason;
    }

    const sunData = sun.status === "fulfilled"
      ? sun.value
      : { sunrise: "--:--", sunset: "--:--" };

    return jsonResponse(200, {
      ok: true,
      ...forecast.value,
      ...sunData
    }, {
      "Cache-Control": "public, max-age=180, s-maxage=300"
    });

  } catch (err) {
    console.error("Weather error:", err);

    return jsonResponse(200, {
      ok: false,
      updatedAt: new Date().toISOString(),
      temperature: 14,
      feelsLike: 14,
      wind: 3,
      rain: 0,
      sunrise: "--:--",
      sunset: "--:--",
      description: "Trykk for Yr",
      symbol: "fair"
    });
  }
};
