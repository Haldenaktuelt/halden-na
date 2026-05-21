const { callOpenAIJson } = require("./ai-analyze.js");

async function writeDraft(input = {}) {
  if (!process.env.OPENAI_API_KEY) return fallbackDraft(input);

  const prompt = `
Du er redaksjonsassistent for lokalavisen HALDEN NÅ.

Du skal lage en REDAKSJONELL KLADD, ikke et sammendrag.

Målet:
Forklar saken kort og forståelig for vanlige lesere.

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
  Avsnitt 1: hva har skjedd
  Avsnitt 2: hvorfor det betyr noe / enkel forklaring

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

  const draft = await callOpenAIJson(prompt, schema, "halden_na_v12_2_draft");

  return {
    success: true,
    kategori: draft.kategori || input.kategori || input.analysis?.kategori || "Lokalt",
    tittel: cleanLine(draft.tittel || input.analysis?.tema || input.title || "Ny lokal sak", 95),
    ingress: cleanLine(draft.ingress || input.analysis?.hovedpoeng || input.ingress || "", 180),
    tekst: cleanArticleText(draft.tekst || "", draft.ingress || input.ingress || "")
  };
}

function fallbackDraft(input = {}) {
  const title = cleanLine(input.analysis?.tema || input.title || "Ny lokal sak", 95);
  const ingress = cleanLine(input.analysis?.hovedpoeng || input.ingress || String(input.content || "").slice(0, 140), 180);

  const body = String(input.content || "")
    .replace(/\s+/g, " ")
    .replace(input.title || "", "")
    .replace(input.ingress || "", "")
    .trim();

  return {
    success: true,
    kategori: input.kategori || input.analysis?.kategori || "Lokalt",
    tittel: title,
    ingress,
    tekst: cleanArticleText(body.slice(0, 520), ingress)
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
    .trim()
    .slice(0, max)
    .trim();
}

function cleanArticleText(value = "", ingress = "") {
  let text = String(value || "")
    .replace(/^kort forklart[:：]?\s*/gim, "")
    .replace(/^ny utvikling[:：]?\s*/gim, "")
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
