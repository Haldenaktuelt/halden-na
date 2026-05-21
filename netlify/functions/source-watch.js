const { runPipelineForSource } = require("../../04_ai_motor/run-pipeline.js");

const PROJECT_ID = "halden-no";
const API_KEY = "AIzaSyA2m43Yd4pEEO4P54G6aXIH0JqQFBkAbWs";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

exports.config = { schedule: "@hourly" };

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  try {
    const result = await runSourceWatch();
    return jsonResponse(200, { ok: true, ...result });
  } catch (err) {
    console.error("source-watch error:", err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};

async function runSourceWatch() {
  const sources = await getCollection("kilder");

  let checked = 0;
  let changed = 0;
  let skipped = 0;
  let duplicates = 0;
  let draftsCreated = 0;
  const results = [];

  for (const source of sources) {
    const s = source.fields;

    if (s.active === false || !s.link) continue;

    checked++;

    const processedHashes = parseStoredList(s.processedHashes || s.lastHashes || s.lastHash || "");
    const processedUrls = parseStoredList(s.processedUrls || "");

    try {
      const pipeline = await runPipelineForSource({
        ...s,
        id: source.id,
        maxArticles: 5,
        minScore: 6
      });

      if (!pipeline.ok) {
        skipped++;
        await updateSource(source.id, {
          lastChecked: new Date().toISOString(),
          lastResult: `Pipeline-feil: ${pipeline.error || "ukjent feil"}`
        });
        results.push({ source: s.name, status: "feil", error: pipeline.error });
        continue;
      }

      const draftResults = pipeline.results.filter(r => r.ok && !r.skipped && r.draft);
      const skippedResults = pipeline.results.filter(r => r.skipped);

      if (!draftResults.length) {
        skipped++;
        const bestSkipped = skippedResults[0];

        await updateSource(source.id, {
          lastChecked: new Date().toISOString(),
          lastResult: bestSkipped?.reason || "Fant ingen god nok sak."
        });

        results.push({
          source: s.name,
          status: "ingen kladd",
          checked: pipeline.checked,
          reason: bestSkipped?.reason || "Ingen god nok sak"
        });

        continue;
      }

      let sourceDrafts = 0;
      let latestDraftId = s.lastDraftId || "";

      for (const item of draftResults) {
        const sourceUrl = normalizeUrl(item.url || s.link || "");
        const hash = await sha256(item.hashText || `${sourceUrl}\n${item.draft.tittel}\n${item.draft.ingress}`);

        if (processedHashes.includes(hash) || processedUrls.includes(sourceUrl)) {
          duplicates++;
          results.push({
            source: s.name,
            status: "duplikat hoppet over",
            title: item.draft.tittel,
            url: sourceUrl
          });
          continue;
        }

        const draftId = `ai-${Date.now()}-${safeId(item.draft.tittel || item.analysis?.tema || s.name || "kilde")}`;

        const draftData = {
          id: draftId,
          kategori: item.draft.kategori || item.analysis?.kategori || "Lokalt",
          tittel: item.draft.tittel || item.analysis?.tema || "Ny lokal sak",
          ingress: item.draft.ingress || item.analysis?.hovedpoeng || "",
          tekst: item.draft.tekst || "",
          bildeUrl: "",
          videoUrl: "",
          mediaPlassering: "top",
          kilde: s.name || "Kilde",
          sourceUrl,
          status: "til_godkjenning",
          dato: new Date().toISOString(),
          tid: nowTime(),
          hovedsak: false,
          aiGenerated: true,
          aiPipeline: "v12.1",
          sourceId: source.id,
          nyhetsverdi: String(item.score || item.analysis?.score || ""),
          tema: item.analysis?.tema || "",
          oppdatertAt: new Date().toISOString()
        };

        await setDocument("kladder", draftId, draftData);
        await setDocument("saker", draftId, draftData);

        processedHashes.unshift(hash);
        processedUrls.unshift(sourceUrl);

        draftsCreated++;
        sourceDrafts++;
        changed++;
        latestDraftId = draftId;

        results.push({
          source: s.name,
          status: "kladd laget",
          title: draftData.tittel,
          nyhetsverdi: draftData.nyhetsverdi,
          draftId,
          draft: draftData
        });
      }

      await updateSource(source.id, {
        lastHash: processedHashes[0] || s.lastHash || "",
        processedHashes: processedHashes.slice(0, 50).join("|"),
        processedUrls: processedUrls.slice(0, 50).join("|"),
        lastChecked: new Date().toISOString(),
        lastResult: sourceDrafts
          ? `V12.1 kladd laget: ${sourceDrafts}`
          : duplicates
            ? "Ingen ny sak. Duplikater hoppet over."
            : "Ingen ny relevant sak funnet.",
        lastDraftId: latestDraftId
      });
    } catch (err) {
      console.error("Kilde feilet:", s.name, err);
      skipped++;

      await updateSource(source.id, {
        lastChecked: new Date().toISOString(),
        lastResult: `Feil: ${err.message.slice(0, 130)}`
      });

      results.push({ source: s.name, status: "feil", error: err.message });
    }
  }

  console.log("source-watch v12.1 result", {
    checked,
    changed,
    skipped,
    duplicates,
    draftsCreated,
    results
  });

  return {
    checked,
    changed,
    skipped,
    duplicates,
    draftsCreated,
    results
  };
}

function parseStoredList(value = "") {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return String(value || "")
    .split("|")
    .map(v => v.trim())
    .filter(Boolean);
}

function normalizeUrl(value = "") {
  return String(value || "").split("#")[0].replace(/\/$/, "").trim();
}

async function getCollection(collectionName) {
  const res = await fetch(`${FIRESTORE_BASE}/${collectionName}?key=${API_KEY}`);
  if (!res.ok) throw new Error(`Firestore lesing feilet ${res.status}: ${await res.text()}`);

  const data = await res.json();

  return (data.documents || []).map(doc => ({
    id: doc.name.split("/").pop(),
    fields: fromFirestoreFields(doc.fields || {})
  }));
}

async function setDocument(collectionName, id, data) {
  const res = await fetch(`${FIRESTORE_BASE}/${collectionName}/${id}?key=${API_KEY}`, {
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
  const updateMask = fields.map(field => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join("&");
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

    if (typeof value === "boolean") {
      fields[key] = { booleanValue: value };
    } else if (typeof value === "number") {
      fields[key] = { doubleValue: value };
    } else {
      fields[key] = { stringValue: String(value) };
    }
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

async function sha256(text) {
  const data = new TextEncoder().encode(String(text || ""));
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
    .slice(0, 44) || "kilde";
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
