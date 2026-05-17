const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=60, s-maxage=120"
};

function jsonResponse(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      ...CORS_HEADERS,
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}

function cleanText(value = "") {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function shortText(value = "", max = 90) {
  const text = cleanText(value);
  if (text.length <= max) return text;
  return text.slice(0, max).trim() + "...";
}

function placeFromText(text = "") {
  const places = [
    "Halden",
    "Sarpsborg",
    "Fredrikstad",
    "Moss",
    "Rakkestad",
    "Aremark",
    "Marker",
    "Indre Østfold",
    "Eidsberg",
    "Askim",
    "Mysen",
    "Råde",
    "Våler",
    "Hvaler"
  ];

  const found = places.find(place =>
    text.toLowerCase().includes(place.toLowerCase())
  );

  return found ? found.toUpperCase() : "ØST";
}

function formatTime(value = "") {
  const d = new Date(value);

  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleTimeString("no-NO", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Oslo"
    });
  }

  const match = String(value).match(/(\d{1,2}:\d{2})/);
  return match ? match[1] : "NÅ";
}

module.exports = {
  CORS_HEADERS,
  jsonResponse,
  cleanText,
  shortText,
  placeFromText,
  formatTime
};