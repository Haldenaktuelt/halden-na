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
  let draftsCreated = 0;
  const results = [];

  for (const source of sources) {
    const s = source.fields;
    if (s.active === false || !s.link) continue;

    checked++;

    try {
      const page = await fetchSourcePage(s.link);
      const candidates = extractStoryCandidates(page.html, s.link);

      if (!candidates.length) {
        skipped++;
        await updateSource(source.id, {
          lastChecked: new Date().toISOString(),
          lastResult: "Fant ingen tydelige saker på kilden."
        });
        results.push({ source: s.name, status: "ingen tydelig sak" });
        continue;
      }

      const bestCandidate = selectBestCandidate(candidates, s);
      const hash = await sha256(bestCandidate.hashText);

      if (s.lastHash && s.lastHash === hash) {
        await updateSource(source.id, {
          lastChecked: new Date().toISOString(),
          lastResult: "Ingen ny relevant sak funnet."
        });
        results.push({ source: s.name, status: "ingen endring" });
        continue;
      }

      const analysis = await analyzeCandidate(s, bestCandidate);

      if (!analysis.lagKladd || Number(analysis.nyhetsverdi || 0) < 6) {
        skipped++;
        await updateSource(source.id, {
          lastHash: hash,
          lastChecked: new Date().toISOString(),
          lastResult: `Ny endring funnet, men ikke god nok sak: ${analysis.begrunnelse || "lav nyhetsverdi"}`
        });
        results.push({ source: s.name, status: "hoppet over", nyhetsverdi: analysis.nyhetsverdi || 0 });
        continue;
      }

      changed++;

      const draft = await writeDraftFromAnalysis(s, bestCandidate, analysis);
      const draftId = `ai-${Date.now()}-${safeId(analysis.tema || s.name || "kilde")}`;

      const draftData = {
        id: draftId,
        kategori: draft.kategori || analysis.kategori || guessCategory(s, bestCandidate.text),
        tittel: draft.tittel || analysis.tema || "Ny lokal sak",
        ingress: draft.ingress || analysis.hovedpoeng || "",
        tekst: draft.tekst || "",
        bildeUrl: "",
        videoUrl: "",
        mediaPlassering: "top",
        kilde: s.name || "Kilde",
        sourceUrl: bestCandidate.url || s.link,
        status: "til_godkjenning",
        dato: new Date().toISOString(),
        tid: nowTime(),
        hovedsak: false,
        aiGenerated: true,
        sourceId: source.id,
        nyhetsverdi: String(analysis.nyhetsverdi || ""),
        tema: analysis.tema || "",
        oppdatertAt: new Date().toISOString()
      };

      await setDocument("kladder", draftId, draftData);
      await setDocument("saker", draftId, draftData);

      draftsCreated++;

      await updateSource(source.id, {
        lastHash: hash,
        lastChecked: new Date().toISOString(),
        lastResult: `Kladd laget: ${draftData.tittel}`,
        lastDraftId: draftId
      });

      results.push({
        source: s.name,
        status: "kladd laget",
        title: draftData.tittel,
        nyhetsverdi: analysis.nyhetsverdi,
        draftId,
        draft: draftData
      });
    } catch (err) {
      console.error("Kilde feilet:", s.name, err);
      await updateSource(source.id, {
        lastChecked: new Date().toISOString(),
        lastResult: `Feil: ${err.message.slice(0, 130)}`
      });
      results.push({ source: s.name, status: "feil", error: err.message });
    }
  }

  console.log("source-watch result", { checked, changed, skipped, draftsCreated, results });
  return { checked, changed, skipped, draftsCreated, results };
}

async function fetchSourcePage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "HaldenNaaKildevakt/2.0 kontakt:redaksjon@halden-naa.no",
      "Accept": "text/html,application/xhtml+xml,application/xml,text/plain"
    }
  });

  if (!res.ok) throw new Error(`Kilden svarte ${res.status}`);

  return {
    url,
    contentType: res.headers.get("content-type") || "",
    html: await res.text()
  };
}

function extractStoryCandidates(html = "", sourceUrl = "") {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ");

  const candidates = [];

  [...withoutNoise.matchAll(/<(article|main)[^>]*>([\s\S]*?)<\/\1>/gi)].forEach((match) => {
    const text = removeCommonNoiseText(htmlToText(match[2]));
    const title = firstHeading(match[2]) || firstTitleFromText(text);

    if (isUsefulCandidate(text, title)) {
      candidates.push({
        title,
        text: trimText(text, 4500),
        url: sourceUrl,
        hashText: `${title}\n${trimText(text, 2000)}`
      });
    }
  });

  extractMunicipalListItems(withoutNoise, sourceUrl).forEach(item => candidates.push(item));

  if (!candidates.length) {
    const text = removeCommonNoiseText(htmlToText(withoutNoise));
    const title = firstTitleFromText(text);

    if (isUsefulCandidate(text, title)) {
      candidates.push({
        title,
        text: trimText(text, 4500),
        url: sourceUrl,
        hashText: `${title}\n${trimText(text, 2000)}`
      });
    }
  }

  return dedupeCandidates(candidates).slice(0, 12);
}

function extractMunicipalListItems(html, sourceUrl) {
  const text = removeCommonNoiseText(htmlToText(html));

  const starts = [
    "Forslag til Detaljregulering",
    "Detaljregulering",
    "Planforslag",
    "Kunngjøring:",
    "Oppstart av arbeid",
    "Planarbeid og høring",
    "Høring",
    "Offentlig ettersyn",
    "Varsel om oppstart"
  ];

  const chunks = [];
  const lower = text.toLowerCase();

  starts.forEach(start => {
    let pos = 0;
    const needle = start.toLowerCase();

    while ((pos = lower.indexOf(needle, pos)) !== -1) {
      const nextPositions = starts
        .map(s => lower.indexOf(s.toLowerCase(), pos + start.length))
        .filter(n => n > pos);

      const end = nextPositions.length ? Math.min(...nextPositions) : Math.min(text.length, pos + 1800);
      chunks.push(text.slice(pos, end).trim());
      pos = end;
    }
  });

  return chunks
    .filter(chunk => chunk.length > 120)
    .slice(0, 10)
    .map(chunk => {
      const title = firstSentence(chunk, 120);
      return {
        title,
        text: trimText(chunk, 2500),
        url: sourceUrl,
        hashText: trimText(chunk, 1500)
      };
    });
}

function selectBestCandidate(candidates, source) {
  const instruction = `${source.name || ""} ${source.instruction || ""}`.toLowerCase();

  const scored = candidates.map(candidate => {
    const hay = `${candidate.title} ${candidate.text}`.toLowerCase();
    let score = 0;

    ["halden", "kommune", "høring", "offentlig ettersyn", "detaljregulering", "ambulansestasjon", "dyrendal", "bygg", "vei", "trafikk", "arrangement", "frist", "innspill"].forEach(word => {
      if (hay.includes(word)) score += 2;
      if (instruction.includes(word) && hay.includes(word)) score += 2;
    });

    if (candidate.text.length > 250 && candidate.text.length < 3500) score += 3;
    if (hay.includes("hopp til innhold")) score -= 5;
    if (hay.includes("cookie")) score -= 3;
    if ((hay.match(/pdf|docx|xlsx/g) || []).length > 4) score -= 4;

    return { candidate, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.candidate || candidates[0];
}

async function analyzeCandidate(source, candidate) {
  if (!process.env.OPENAI_API_KEY) return fallbackAnalysis(source, candidate);

  const input = `
Du er redaksjonell kildevakt for lokalavisen HALDEN NÅ.

Du skal IKKE skrive artikkel nå.
Du skal først vurdere om dette faktisk er en lokal sak.

Svar strengt som JSON etter skjema.

Regler:
- Ikke lag sak av menyer, forsideoversikt eller dokumentlister alene.
- Se etter én konkret nyhet/hendelse/sak.
- Vurder relevans for Halden.
- Hvis råstoffet bare er en liste over flere saker: velg den viktigste konkrete saken.
- Hvis nyhetsverdien er lav: lagKladd=false.
- Ikke dikt opp fakta.

Kilde: ${source.name || ""}
URL: ${candidate.url || source.link || ""}
Redaksjonsinstruks: ${source.instruction || ""}

KANDIDAT:
Tittel: ${candidate.title || ""}
Tekst:
${candidate.text}
`;

  return await callOpenAI(input, analysisSchema(), "halden_na_analysis");
}

async function writeDraftFromAnalysis(source, candidate, analysis) {
  if (!process.env.OPENAI_API_KEY) return fallbackDraft(source, candidate, analysis);

  const input = `
Du er redaksjonsassistent for lokalavisen HALDEN NÅ.

Skriv en kort kladd basert på analysen og kilden.

Regler:
- Skriv som lokalavis.
- Kort og folkelig.
- Maks 100–150 ord.
- Forklar hva saken betyr for folk.
- Ikke list opp PDF-er, vedlegg eller dokumentnavn.
- Ikke skriv teknisk.
- Ikke finn på fakta.
- Ikke skriv at "AI" har laget saken.
- Bruk kun fakta fra råstoffet.
- Menneske skal kontrollere før publisering.

Kilde: ${source.name || ""}
URL: ${candidate.url || source.link || ""}

ANALYSE:
${JSON.stringify(analysis, null, 2)}

RÅSTOFF:
${candidate.text}
`;

  return await callOpenAI(input, draftSchema(), "halden_na_draft");
}

async function callOpenAI(input, schema, name) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input,
      text: { format: { type: "json_schema", name, strict: true, schema } }
    })
  });

  if (!res.ok) throw new Error(`OpenAI svarte ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const text = data.output_text || data.output?.[0]?.content?.[0]?.text || "";
  return JSON.parse(text);
}

function analysisSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      relevant: { type: "boolean" },
      nyhetsverdi: { type: "number" },
      kategori: { type: "string", enum: ["Lokalt","Politilogg","Kommune","Arrangement","Trafikk","Sport","Norge & Verden","Kultur","Meninger","Historie","Kort forklart","Tips"] },
      tema: { type: "string" },
      hovedpoeng: { type: "string" },
      lagKladd: { type: "boolean" },
      begrunnelse: { type: "string" }
    },
    required: ["relevant", "nyhetsverdi", "kategori", "tema", "hovedpoeng", "lagKladd", "begrunnelse"]
  };
}

function draftSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      kategori: { type: "string", enum: ["Lokalt","Politilogg","Kommune","Arrangement","Trafikk","Sport","Norge & Verden","Kultur","Meninger","Historie","Kort forklart","Tips"] },
      tittel: { type: "string" },
      ingress: { type: "string" },
      tekst: { type: "string" }
    },
    required: ["kategori", "tittel", "ingress", "tekst"]
  };
}

function fallbackAnalysis(source, candidate) {
  const text = `${candidate.title} ${candidate.text}`;
  return {
    relevant: true,
    nyhetsverdi: 6,
    kategori: guessCategory(source, text),
    tema: candidate.title || "Mulig lokal sak",
    hovedpoeng: firstSentence(candidate.text, 180),
    lagKladd: true,
    begrunnelse: "Fallback-vurdering uten OpenAI."
  };
}

function fallbackDraft(source, candidate, analysis) {
  const ingress = analysis.hovedpoeng || firstSentence(candidate.text, 150);
  return {
    kategori: analysis.kategori || guessCategory(source, candidate.text),
    tittel: analysis.tema || candidate.title || "Ny lokal sak",
    ingress,
    tekst: `${ingress}\n\nKort forklart:\n${trimText(removeCommonNoiseText(candidate.text), 700)}\n\nKilde: ${source.name || "Kilde"}`
  };
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
  const clean = { ...data, oppdatertAt: new Date().toISOString() };
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

function firstHeading(html = "") {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>|<h2[^>]*>([\s\S]*?)<\/h2>/i);
  return match ? cleanText(htmlToText(match[1] || match[2] || "")) : "";
}

function firstTitleFromText(text = "") {
  return firstSentence(text, 100);
}

function firstSentence(text = "", max = 160) {
  const clean = cleanText(text);
  const sentence = clean.split(/(?<=[.!?])\s+/)[0] || clean;
  return trimText(sentence, max);
}

function isUsefulCandidate(text = "", title = "") {
  const clean = cleanText(text);
  if (clean.length < 120) return false;
  if (!title && clean.length < 300) return false;
  if ((clean.match(/Hopp til/g) || []).length > 3) return false;
  return true;
}

function removeCommonNoiseText(text = "") {
  let clean = cleanText(text);
  ["Hopp til innhold","Hopp til meny","Hopp til søk","Du er her:","Hjem","Søk","Meny","Kontakt oss","Personvern","Til toppen"].forEach(n => {
    clean = clean.replaceAll(n, " ");
  });
  clean = clean.replace(/\b(pdf|docx|xlsx|pptx)\b/gi, " ");
  return clean.replace(/\s+/g, " ").trim();
}

function htmlToText(html = "") {
  return cleanText(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<\/h[1-6]>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
  );
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter(c => {
    const key = cleanText(c.title || c.text.slice(0, 120)).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanText(value = "") {
  return String(value)
    .replace(/\s+/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&aring;/g, "å")
    .replace(/&oslash;/g, "ø")
    .replace(/&aelig;/g, "æ")
    .trim();
}

function trimText(text = "", max = 1000) {
  const clean = cleanText(text);
  return clean.length > max ? clean.slice(0, max).trim() + "..." : clean;
}

function guessCategory(source, text) {
  const hay = `${source.name || ""} ${source.instruction || ""} ${text}`.toLowerCase();
  if (hay.includes("kommune") || hay.includes("regulering") || hay.includes("høring") || hay.includes("offentlig ettersyn")) return "Kommune";
  if (hay.includes("arrangement") || hay.includes("konsert") || hay.includes("festival")) return "Arrangement";
  if (hay.includes("trafikk") || hay.includes("vei")) return "Trafikk";
  if (hay.includes("kamp") || hay.includes("fotball")) return "Sport";
  return "Lokalt";
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, "0")).join("");
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
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(body) };
}
