const { callOpenAIJson } = require("./ai-analyze.js");

async function writeDraft(input = {}) {
  if (!process.env.OPENAI_API_KEY) return fallbackDraft(input);

  const prompt = `
Du er redaksjonsassistent for lokalavisen HALDEN NÅ.

Skriv en kort kladd basert på råstoffet.

Stil:
- kort forklart
- lokalavis
- rolig og folkelig
- korte avsnitt
- ingen clickbait
- ikke skriv at AI har laget saken
- ikke finn på fakta
- ikke list opp dokumentnavn eller vedlegg

Maks 100–160 ord.

Kategori: ${input.kategori || "Lokalt"}
Kilde: ${input.sourceName || input.source || ""}
URL: ${input.sourceUrl || input.url || ""}

Analyse:
${JSON.stringify(input.analysis || {}, null, 2)}

Tittel: ${input.title || ""}
Ingress: ${input.ingress || ""}

Råstoff:
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

  const draft = await callOpenAIJson(prompt, schema, "halden_na_v12_draft");
  return { success: true, ...draft };
}

function fallbackDraft(input = {}) {
  const title = input.title || input.analysis?.tema || "Ny lokal sak";
  const ingress = input.ingress || input.analysis?.hovedpoeng || String(input.content || "").slice(0, 150);
  const tekst = `${ingress}\n\nKort forklart:\n${String(input.content || "").replace(/\s+/g, " ").slice(0, 700)}${String(input.content || "").length > 700 ? "..." : ""}`;

  return {
    success: true,
    kategori: input.kategori || input.analysis?.kategori || "Lokalt",
    tittel: title,
    ingress,
    tekst
  };
}

module.exports = { writeDraft };
