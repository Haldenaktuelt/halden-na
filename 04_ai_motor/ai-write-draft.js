const { callOpenAIJson } = require("./ai-analyze.js");

async function writeDraft(input = {}) {
  if (!process.env.OPENAI_API_KEY) return fallbackDraft(input);

  const prompt = `
Du er redaksjonsassistent for lokalavisen HALDEN NÅ.

Skriv en NY lokalavis-kladd basert på råstoffet.

VIKTIG:
- Ikke kopier setninger fra råstoffet.
- Ikke gjenta ingressen i brødteksten.
- Ikke skriv "Kort forklart:".
- Ikke list opp detaljer som ikke er viktige for folk i Halden.
- Ikke bruk AI-språk.
- Ikke finn på fakta.
- Ikke skriv at dette er hentet fra AI.
- Bruk korte avsnitt.
- Skriv enkelt, rolig og folkelig.

Format:
- Tittel: kort og tydelig
- Ingress: 1 kort setning
- Tekst: 2–3 korte avsnitt, maks 120 ord

Vinkel:
Forklar saken som en lokal redaktør ville gjort det for folk i Halden.

Kategori: ${input.kategori || "Lokalt"}
Kilde: ${input.sourceName || input.source || ""}
URL: ${input.sourceUrl || input.url || ""}

Analyse:
${JSON.stringify(input.analysis || {}, null, 2)}

Råstoff:
Tittel: ${input.title || ""}
Ingress: ${input.ingress || ""}
Tekst:
${input.content || ""}
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

  const draft = await callOpenAIJson(prompt, schema, "halden_na_v12_1_draft");

  return {
    success: true,
    kategori: draft.kategori || input.kategori || input.analysis?.kategori || "Lokalt",
    tittel: cleanLine(draft.tittel || input.analysis?.tema || input.title || "Ny lokal sak", 90),
    ingress: cleanLine(draft.ingress || input.analysis?.hovedpoeng || input.ingress || "", 180),
    tekst: cleanArticleText(draft.tekst || "")
  };
}

function fallbackDraft(input = {}) {
  const title = cleanLine(input.analysis?.tema || input.title || "Ny lokal sak", 90);
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
    tekst: cleanArticleText(`${ingress}\n\n${body.slice(0, 520)}${body.length > 520 ? "..." : ""}`)
  };
}

function cleanLine(value = "", max = 160) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^kort forklart[:：]?\s*/i, "")
    .trim()
    .slice(0, max)
    .trim();
}

function cleanArticleText(value = "") {
  let text = String(value || "")
    .replace(/^kort forklart[:：]?\s*/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const paragraphs = text
    .split(/\n+/)
    .map(p => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const deduped = [];
  const seen = new Set();

  for (const p of paragraphs) {
    const key = p.toLowerCase().slice(0, 90);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(p);
  }

  return deduped.slice(0, 3).join("\n\n").trim();
}

module.exports = { writeDraft };
