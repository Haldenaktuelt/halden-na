const { callOpenAIJson } = require("./ai-analyze.js");

async function writeDraft(input = {}) {
  if (!process.env.OPENAI_API_KEY) return fallbackDraft(input);

  const documentAnalysis = input.documentAnalysis || null;

  const prompt = documentAnalysis
    ? documentPrompt(input, documentAnalysis)
    : articlePrompt(input);

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      kategori: { type: "string" },
      tittel: { type: "string" },
      ingress: { type: "string" },
      tekst: { type: "string" }
    },
    required: ["kategori", "tittel", "ingress", "tekst"]
  };

  const draft = await callOpenAIJson(prompt, schema, "halden_na_v14_3_draft");

  return {
    success: true,
    kategori: draft.kategori || input.kategori || input.analysis?.kategori || documentAnalysis?.category || "Lokalt",
    tittel: cleanLine(draft.tittel || documentAnalysis?.suggestedTitle || input.analysis?.tema || input.title || "Ny lokal sak", 95),
    ingress: cleanLine(draft.ingress || documentAnalysis?.suggestedIngress || input.analysis?.hovedpoeng || input.ingress || "", 190),
    tekst: cleanArticleText(draft.tekst || "", draft.ingress || input.ingress || "")
  };
}

function documentPrompt(input = {}, documentAnalysis = {}) {
  return `
Du er redaksjonsassistent for lokalavisen HALDEN NÅ.

Du skal skrive en kort lokalavis-kladd basert på en strukturert analyse av et kommunalt dokument.

VIKTIG:
- Skriv som en lokalavis, ikke som et saksdokument.
- Ikke skriv om arkivkode, journalnummer, PDF-størrelse eller saksbehandler.
- Ikke start med dokumenttittelen hvis den er teknisk.
- Ikke bruk "Kort forklart:".
- Ikke bruk "NY UTVIKLING".
- Ikke finn på fakta.
- Ikke overdriv.
- Skriv enkelt og folkelig.
- Maks 120–150 ord i brødteksten.

Format:
- Tittel: Hva skjer?
- Ingress: Hvorfor bør folk bry seg?
- Tekst: 2 korte avsnitt.
  Avsnitt 1: hva saken gjelder.
  Avsnitt 2: hva det betyr / hva folk kan gjøre.

Kategori: ${documentAnalysis.category || input.kategori || "Kommune"}
Kilde: ${input.sourceName || input.source || ""}
URL: ${input.sourceUrl || input.url || ""}

DOKUMENTANALYSE:
${JSON.stringify(documentAnalysis, null, 2)}

Kort utdrag fra dokument:
${trimForPrompt(input.content || "", 1800)}
`;
}

function articlePrompt(input = {}) {
  return `
Du er redaksjonsassistent for lokalavisen HALDEN NÅ.

Du skal lage en REDAKSJONELL KLADD, ikke et sammendrag.

VIKTIGE REGLER:
- Ikke kopier setninger fra kilden.
- Ikke gjenta ingressen i brødteksten.
- Ikke start brødteksten med samme fakta som ingressen.
- Ikke bruk "Kort forklart:".
- Ikke bruk "NY UTVIKLING".
- Ikke skriv lange avsnitt.
- Ikke skriv mer enn 90–120 ord i brødteksten.
- Ikke ta med uviktige detaljer.
- Ikke finn på fakta.
- Ikke skriv at AI har skrevet teksten.

Format:
- tittel: kort, tydelig og nøktern
- ingress: én setning som forklarer hovedpoenget
- tekst: 2 korte avsnitt

Skriv på norsk bokmål, folkelig og rolig.

Kategori: ${input.kategori || "Lokalt"}
Kilde: ${input.sourceName || input.source || ""}
URL: ${input.sourceUrl || input.url || ""}

Analyse:
${JSON.stringify(input.analysis || {}, null, 2)}

RÅSTOFF:
Tittel: ${input.title || ""}
Ingress: ${input.ingress || ""}
Tekst:
${trimForPrompt(input.content || "", 2600)}
`;
}

function fallbackDraft(input = {}) {
  const doc = input.documentAnalysis || {};
  const title = cleanLine(doc.suggestedTitle || input.analysis?.tema || input.title || "Ny lokal sak", 95);
  const ingress = cleanLine(doc.suggestedIngress || input.analysis?.hovedpoeng || input.ingress || String(input.content || "").slice(0, 140), 190);

  const body = doc.proposal || doc.importance || String(input.content || "").slice(0, 520);

  return {
    success: true,
    kategori: input.kategori || doc.category || input.analysis?.kategori || "Lokalt",
    tittel: title,
    ingress,
    tekst: cleanArticleText(`${body}\n\n${doc.publicAction || ""}`, ingress)
  };
}

function trimForPrompt(value = "", max = 2600) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max).trim() + "..." : clean;
}

function cleanLine(value = "", max = 160) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^kort forklart[:：]?\s*/i, "")
    .replace(/^ny utvikling[:：]?\s*/i, "")
    .replace(/\b(pdf|docx|xlsx)\b/gi, "")
    .trim()
    .slice(0, max)
    .trim();
}

function cleanArticleText(value = "", ingress = "") {
  let text = String(value || "")
    .replace(/^kort forklart[:：]?\s*/gim, "")
    .replace(/^ny utvikling[:：]?\s*/gim, "")
    .replace(/arkivkode[:\s\S]{0,80}/gi, "")
    .replace(/arkivsaksnr[:\s\S]{0,80}/gi, "")
    .replace(/journal\s*dato[:\s\S]{0,80}/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const ingressKey = normalizeForCompare(ingress).slice(0, 80);

  const paragraphs = text
    .split(/\n+/)
    .map(p => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter(p => {
      const key = normalizeForCompare(p);
      if (!key) return false;
      if (ingressKey && key.startsWith(ingressKey.slice(0, 45))) return false;
      if (/(arkivkode|arkivsak|journal|saksbehandler|pdf \d|kb\b)/i.test(p)) return false;
      return true;
    });

  const deduped = [];
  const seen = new Set();

  for (const p of paragraphs) {
    const key = normalizeForCompare(p).slice(0, 90);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(p);
  }

  return deduped.slice(0, 2).join("\n\n").trim();
}

function normalizeForCompare(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = { writeDraft };
