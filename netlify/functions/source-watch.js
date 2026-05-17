const PROJECT_ID = "halden-no";
const API_KEY = "AIzaSyA2m43Yd4pEEO4P54G6aXIH0JqQFBkAbWs";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

exports.config = {
  schedule: "@hourly"
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: ""
    };
  }

  try {
    const result = await runSourceWatch();

    return jsonResponse(200, {
      ok: true,
      ...result
    });
  } catch (err) {
    console.error("source-watch error:", err);

    return jsonResponse(500, {
      ok: false,
      error: err.message
    });
  }
};

async function runSourceWatch() {
  const sources = await getCollection("kilder");
  let checked = 0;
  let changed = 0;
  let draftsCreated = 0;
  const results = [];

  for (const source of sources) {
    const s = source.fields;

    if (s.active === false) continue;
    if (!s.link) continue;

    checked++;

    try {
      const rawText = await fetchSourceText(s.link);
      const text = cleanText(rawText).slice(0, 9000);
      const hash = await sha256(text);

      if (!text || text.length < 250) {
        await updateSource(source.id, {
          lastChecked: new Date().toISOString(),
          lastResult: "Fant for lite tekst til å lage sak."
        });

        results.push({ source: s.name, status: "lite tekst" });
        continue;
      }

      if (s.lastHash && s.lastHash === hash) {
        await updateSource(source.id, {
          lastChecked: new Date().toISOString(),
          lastResult: "Ingen endring funnet."
        });

        results.push({ source: s.name, status: "ingen endring" });
        continue;
      }

      changed++;

      const draft = await makeDraftFromSource(s, text);
      const draftId = `ai-${Date.now()}-${safeId(s.name || "kilde")}`;

      await setDocument("saker", draftId, {
        id: draftId,
        kategori: draft.kategori,
        tittel: draft.tittel,
        ingress: draft.ingress,
        tekst: draft.tekst,
        bildeUrl: "",
        videoUrl: "",
        mediaPlassering: "top",
        kilde: s.name || "Kilde",
        sourceUrl: s.link,
        status: "til_godkjenning",
        dato: new Date().toISOString(),
        tid: nowTime(),
        hovedsak: false,
        aiGenerated: true,
        sourceId: source.id,
        oppdatertAt: new Date().toISOString()
      });

      draftsCreated++;

      await updateSource(source.id, {
        lastHash: hash,
        lastChecked: new Date().toISOString(),
        lastResult: `Ny endring funnet. Kladd laget: ${draft.tittel}`,
        lastDraftId: draftId
      });

      results.push({ source: s.name, status: "kladd laget", title: draft.tittel });
    } catch (err) {
      await updateSource(source.id, {
        lastChecked: new Date().toISOString(),
        lastResult: `Feil: ${err.message.slice(0, 120)}`
      });

      results.push({ source: s.name, status: "feil", error: err.message });
    }
  }

  console.log("source-watch result", { checked, changed, draftsCreated, results });
  return { checked, changed, draftsCreated, results };
}

async function fetchSourceText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "HaldenNaaKildevakt/1.0 kontakt:redaksjon@halden-naa.no",
      "Accept": "text/html,application/xhtml+xml,application/xml,text/plain"
    }
  });

  if (!res.ok) throw new Error(`Kilden svarte ${res.status}`);

  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  if (contentType.includes("html")) {
    return htmlToText(text);
  }

  return text;
}

async function makeDraftFromSource(source, text) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return fallbackDraft(source, text);
  }

  const input = `
Du er kildevakt og redaksjonsassistent for lokalavisen HALDEN NÅ.

Oppgave:
Vurder om råstoffet kan bli en kort lokal nyhet.
Hvis det kan bli sak: lag et utkast.
Ikke dikt opp fakta.
Ikke påstå mer enn kilden sier.
Skriv folkelig og kort forklart.
Menneske skal alltid godkjenne før publisering.

Kilde: ${source.name || ""}
URL: ${source.link || ""}
Instruks fra redaksjonen: ${source.instruction || ""}

RÅSTOFF:
${text}
`;

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input,
      text: {
        format: {
          type: "json_schema",
          name: "halden_na_source_draft",
          strict: true,
          schema: draftSchema()
        }
      }
    })
  });

  if (!res.ok) {
    throw new Error(`OpenAI svarte ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const outputText = data.output_text || data.output?.[0]?.content?.[0]?.text || "";
  return JSON.parse(outputText);
}

function fallbackDraft(source, text) {
  const clean = cleanText(text);
  const ingress = clean.slice(0, 150) + (clean.length > 150 ? "..." : "");

  return {
    kategori: guessCategory(source, clean),
    tittel: `${source.name || "Ny kilde"}: mulig ny sak`,
    ingress,
    tekst: `${ingress}\n\nKort forklart:\n${clean.slice(0, 1600)}\n\nDette er et automatisk utkast og må kontrolleres før publisering.`
  };
}

function draftSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      kategori: {
        type: "string",
        enum: [
          "Lokalt",
          "Politilogg",
          "Kommune",
          "Arrangement",
          "Trafikk",
          "Sport",
          "Norge & Verden",
          "Kultur",
          "Meninger",
          "Historie",
          "Kort forklart",
          "Tips"
        ]
      },
      tittel: { type: "string" },
      ingress: { type: "string" },
      tekst: { type: "string" }
    },
    required: ["kategori", "tittel", "ingress", "tekst"]
  };
}

function guessCategory(source, text) {
  const hay = `${source.name || ""} ${source.instruction || ""} ${text}`.toLowerCase();

  if (hay.includes("kommune") || hay.includes("regulering") || hay.includes("høring")) return "Kommune";
  if (hay.includes("arrangement") || hay.includes("konsert") || hay.includes("festival")) return "Arrangement";
  if (hay.includes("trafikk") || hay.includes("vei")) return "Trafikk";
  if (hay.includes("kamp") || hay.includes("fotball")) return "Sport";

  return "Lokalt";
}

async function getCollection(collectionName) {
  const url = `${FIRESTORE_BASE}/${collectionName}?key=${API_KEY}`;
  const res = await fetch(url);

  if (!res.ok) throw new Error(`Firestore lesing feilet ${res.status}: ${await res.text()}`);

  const data = await res.json();

  return (data.documents || []).map(doc => ({
    id: doc.name.split("/").pop(),
    fields: fromFirestoreFields(doc.fields || {})
  }));
}

async function setDocument(collectionName, id, data) {
  const url = `${FIRESTORE_BASE}/${collectionName}/${id}?key=${API_KEY}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: toFirestoreFields(data) })
  });

  if (!res.ok) throw new Error(`Firestore skriving feilet ${res.status}: ${await res.text()}`);

  return await res.json();
}

async function updateSource(id, data) {
  const clean = {
    ...data,
    oppdatertAt: new Date().toISOString()
  };

  const fields = Object.keys(clean);
  const updateMask = fields
    .map(field => `updateMask.fieldPaths=${encodeURIComponent(field)}`)
    .join("&");

  const url = `${FIRESTORE_BASE}/kilder/${id}?key=${API_KEY}&${updateMask}`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: toFirestoreFields(clean) })
  });

  if (!res.ok) throw new Error(`Firestore kilde-oppdatering feilet ${res.status}: ${await res.text()}`);

  return await res.json();
}

function toFirestoreFields(obj) {
  const fields = {};

  Object.entries(obj).forEach(([key, value]) => {
    if (value === undefined) return;

    if (typeof value === "boolean") fields[key] = { booleanValue: value };
    else if (typeof value === "number") fields[key] = { doubleValue: value };
    else fields[key] = { stringValue: String(value) };
  });

  return fields;
}

function fromFirestoreFields(fields) {
  const obj = {};

  Object.entries(fields).forEach(([key, value]) => {
    if ("stringValue" in value) obj[key] = value.stringValue;
    else if ("booleanValue" in value) obj[key] = value.booleanValue;
    else if ("doubleValue" in value) obj[key] = value.doubleValue;
    else if ("integerValue" in value) obj[key] = Number(value.integerValue);
    else if ("timestampValue" in value) obj[key] = value.timestampValue;
  });

  return obj;
}

function cleanText(value = "") {
  return String(value)
    .replace(/\s+/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .trim();
}

function htmlToText(html = "") {
  return cleanText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<header[\s\S]*?<\/header>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<[^>]*>/g, " ")
  );
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  return [...new Uint8Array(hashBuffer)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeId(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "kilde";
}

function nowTime() {
  return new Date().toLocaleTimeString("no-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo"
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8"
  };
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(body)
  };
}
