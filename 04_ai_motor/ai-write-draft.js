const { callOpenAIJson } = require("./ai-analyze.js");

async function writeDraft(input = {}) {
  if (!process.env.OPENAI_API_KEY) return fallbackDraft(input);

  const documentAnalysis = input.documentAnalysis || null;
  const prompt = documentAnalysis ? documentPrompt(input, documentAnalysis) : articlePrompt(input);

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

  const draft = await callOpenAIJson(prompt, schema, "halden_na_v14_4_editorial_draft");

  return {
    success: true,
    kategori: draft.kategori || input.kategori || input.analysis?.kategori || documentAnalysis?.category || "Lokalt",
    tittel: cleanTitle(draft.tittel || documentAnalysis?.suggestedTitle || input.analysis?.tema || input.title || "Ny lokal sak"),
    ingress: cleanLine(draft.ingress || documentAnalysis?.suggestedIngress || input.analysis?.hovedpoeng || input.ingress || "", 210),
    tekst: cleanArticleText(draft.tekst || "", draft.ingress || input.ingress || "")
  };
}

function documentPrompt(input = {}, documentAnalysis = {}) {
  return `
Du er redaksjonsassistent for lokalavisen HALDEN NÅ.

Skriv en kort, folkelig lokalavis-kladd basert på dokumentanalysen.

ABSOLUTTE REGLER:
- Ikke bruk dokumentnavn som tittel.
- Ikke skriv "Saksfremlegg", "protokoll", "PDF", "arkivkode", "journalnummer", "saksbehandler" eller filstørrelse.
- Ikke skriv "Kort forklart:".
- Ikke bruk "NY UTVIKLING".
- Ikke finn på fakta.
- Ikke overdriv.
- Ikke skriv mer enn 130 ord i brødteksten.
- Skriv som en lokalavis, ikke som kommunen.

Tittel: Hva saken faktisk handler om.
Ingress: Hvorfor dette er relevant lokalt.
Brødtekst: 2 korte avsnitt:
1. Hva saken gjelder.
2. Hva det betyr / hva som skjer videre / om folk kan gi innspill.

Kategori: ${documentAnalysis.category || input.kategori || "Kommune"}
Kilde: ${input.sourceName || input.source || ""}
URL: ${input.sourceUrl || input.url || ""}

DOKUMENTFORSTÅELSE:
${JSON.stringify(documentAnalysis, null, 2)}

Utdrag fra dokumentet kun for faktasjekk:
${trimForPrompt(input.content || "", 1800)}
`;
}

function articlePrompt(input = {}) {
  return `
Du er redaksjonsassistent for lokalavisen HALDEN NÅ.
Lag en redaksjonell kladd, ikke et sammendrag.
Ikke kopier setninger. Ikke gjenta ingressen. Ikke bruk "Kort forklart:".
Format: tittel, ingress, tekst med 2 korte avsnitt.

Kategori: ${input.kategori || "Lokalt"}
Kilde: ${input.sourceName || input.source || ""}
URL: ${input.sourceUrl || input.url || ""}

Analyse:
${JSON.stringify(input.analysis || {}, null, 2)}

Råstoff:
${trimForPrompt(input.content || "", 2600)}
`;
}

function fallbackDraft(input = {}) {
  const doc = input.documentAnalysis || {};
  const title = cleanTitle(doc.suggestedTitle || input.analysis?.tema || input.title || "Ny lokal sak");
  const ingress = cleanLine(doc.suggestedIngress || input.analysis?.hovedpoeng || input.ingress || String(input.content || "").slice(0, 140), 210);
  const body = [doc.proposal, doc.importance, doc.publicAction].filter(Boolean).join("\n\n");

  return {
    success: true,
    kategori: input.kategori || doc.category || input.analysis?.kategori || "Lokalt",
    tittel: title,
    ingress,
    tekst: cleanArticleText(body || String(input.content || "").slice(0, 520), ingress)
  };
}

function cleanTitle(value = "") {
  let title = cleanLine(value, 105)
    .replace(/\bSaksfremlegg\b/gi, "")
    .replace(/\bSaksframlegg\b/gi, "")
    .replace(/\bmed protokoll\b/gi, "")
    .replace(/\(.*?pdf.*?\)/gi, "")
    .replace(/\bPDF\b/gi, "")
    .replace(/\b\d+\s?kB\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!title || /(arkiv|journal|saksbehandler|protokoll|vedlegg)/i.test(title)) {
    title = "Kommunal sak i Halden forklart enkelt";
  }

  return title;
}

function trimForPrompt(value = "", max = 2600) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max).trim() + "..." : clean;
}

function cleanLine(value = "", max = 160) {
  return String(value || "").replace(/\s+/g, " ").replace(/^kort forklart[:：]?\s*/i, "").replace(/^ny utvikling[:：]?\s*/i, "").replace(/\.pdf|\.docx|\.xlsx/gi, "").trim().slice(0, max).trim();
}

function cleanArticleText(value = "", ingress = "") {
  let text = String(value || "")
    .replace(/^kort forklart[:：]?\s*/gim, "")
    .replace(/^ny utvikling[:：]?\s*/gim, "")
    .replace(/arkivkode[:\s\S]{0,80}/gi, "")
    .replace(/arkivsaksnr[:\s\S]{0,80}/gi, "")
    .replace(/journal\s*dato[:\s\S]{0,80}/gi, "")
    .replace(/\bSaksfremlegg\b/gi, "")
    .replace(/\bSaksframlegg\b/gi, "")
    .replace(/\bPDF\b/gi, "")
    .replace(/\b\d+\s?kB\b/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const ingressKey = normalizeForCompare(ingress).slice(0, 80);
  const paragraphs = text.split(/\n+/).map(p => p.replace(/\s+/g, " ").trim()).filter(Boolean).filter(p => {
    const key = normalizeForCompare(p);
    if (!key) return false;
    if (ingressKey && key.startsWith(ingressKey.slice(0, 45))) return false;
    if (/(arkivkode|arkivsak|journal|saksbehandler|pdf \d|kb\b|protokoll)/i.test(p)) return false;
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
  return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

module.exports = { writeDraft };
