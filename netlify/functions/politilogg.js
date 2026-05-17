const {
  CORS_HEADERS,
  jsonResponse,
  cleanText,
  shortText,
  placeFromText,
  formatTime
} = require("./_utils");

function getTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!match) return "";
  return match[1]
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .trim();
}

function parseRss(xml) {
  const itemMatches = [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)];

  return itemMatches.slice(0, 12).map(match => {
    const item = match[0];
    const title = cleanText(getTag(item, "title"));
    const description = cleanText(getTag(item, "description"));
    const pubDate = getTag(item, "pubDate");
    const combined = `${title} ${description}`;

    return {
      time: formatTime(pubDate || title),
      place: placeFromText(combined),
      text: shortText(title || description || "Ny melding fra politiet.", 95),
      source: "Politiet"
    };
  }).filter(item => item.text);
}

function parsePolitietHtml(html) {
  const text = cleanText(html);

  const chunks = text
    .split(/(?=Øst Politidistrikt\s+(?:Pågår|Avsluttet))/g)
    .filter(chunk => chunk.startsWith("Øst Politidistrikt"))
    .slice(0, 8);

  return chunks.map(chunk => {
    const timeMatch = chunk.match(/\b(\d{1,2}:\d{2})\b/);
    const placeMatch = chunk.match(/(?:Pågår|Avsluttet)\s+[^:]+:\s+([^0-9]+?)\s+\d{1,2}:\d{2}/);
    const afterTime = timeMatch ? chunk.slice(chunk.indexOf(timeMatch[1]) + timeMatch[1].length) : chunk;
    const place = placeMatch ? cleanText(placeMatch[1]) : placeFromText(chunk);

    return {
      time: timeMatch ? timeMatch[1] : "NÅ",
      place: String(place || "ØST").toUpperCase(),
      text: shortText(afterTime, 95),
      source: "Politiet"
    };
  }).filter(item => item.text && item.text.length > 8);
}

async function fetchText(url, accept = "application/rss+xml, application/xml, text/xml, text/html") {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "HaldenNaa/1.0 kontakt: redaksjon@halden-naa.no",
      "Accept": accept
    }
  });

  if (!res.ok) throw new Error(`${url} svarte ${res.status}`);
  return await res.text();
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  const rssUrls = [
    "https://www.politiet.no/api/rss/politiloggen?distrikt=ost",
    "https://www.politiet.no/api/rss/politiloggen?district=ost",
    "https://www.politiet.no/politiloggen/rss?distrikt=ost",
    "https://api.politiet.no/politiloggen/rss?distrikt=ost"
  ];

  for (const url of rssUrls) {
    try {
      const text = await fetchText(url);

      if (text.includes("<item")) {
        const items = parseRss(text);

        if (items.length) {
          return jsonResponse(200, {
            ok: true,
            source: url,
            updatedAt: new Date().toISOString(),
            items
          }, {
            "Cache-Control": "public, max-age=60, s-maxage=120"
          });
        }
      }
    } catch (err) {
      console.error("Politilogg RSS error:", err.message);
    }
  }

  try {
    const html = await fetchText(
      "https://www.politiet.no/politiloggen?distrikt=ost",
      "text/html"
    );

    const items = parsePolitietHtml(html);

    if (items.length) {
      return jsonResponse(200, {
        ok: true,
        source: "https://www.politiet.no/politiloggen?distrikt=ost",
        updatedAt: new Date().toISOString(),
        items
      }, {
        "Cache-Control": "public, max-age=60, s-maxage=120"
      });
    }
  } catch (err) {
    console.error("Politilogg HTML error:", err.message);
  }

  return jsonResponse(200, {
    ok: false,
    updatedAt: new Date().toISOString(),
    items: [
      {
        time: "NÅ",
        place: "ØST",
        text: "Trykk for å åpne politiets egen logg.",
        source: "Fallback"
      },
      {
        time: "INFO",
        place: "HALDEN",
        text: "Test med netlify dev eller publisert Netlify-side.",
        source: "Fallback"
      }
    ]
  });
};
