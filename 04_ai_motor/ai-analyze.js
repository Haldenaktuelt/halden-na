async function analyzeArticle(input = {}) {
  if (!process.env.OPENAI_API_KEY) return fallbackAnalyze(input);

  const prompt = `
Du er redaksjonell kildevakt for lokalavisen HALDEN NÅ.

Du skal IKKE skrive artikkel nå.
Du skal bare vurdere om råstoffet er verdt en kladd.

Svar kun som JSON.

Regler:
- Finn én konkret sak.
- Ikke godkjenn menyer, forsider, dokumentlister eller støy.
- Ikke dikt opp fakta.
- Vurder relevans for Halden.
- Bruk kategori fra lovlig liste.

Lovlige kategorier:
Lokalt, Politilogg, Kommune, Arrangement, Trafikk, Sport, Norge & Verden, Kultur, Meninger, Historie, Kort forklart, Tips

Kilde: ${input.sourceName || ""}
URL: ${input.url || ""}
Instruks: ${input.instruction || ""}

Tittel: ${input.title || ""}
Ingress: ${input.ingress || ""}

Tekst:
${input.content || ""}
`;

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      worthy: { type: "boolean" },
      score: { type: "number" },
      kategori: { type: "string" },
      tema: { type: "string" },
      hovedpoeng: { type: "string" },
      reason: { type: "string" }
    },
    required: ["worthy", "score", "kategori", "tema", "hovedpoeng", "reason"]
  };

  return await callOpenAIJson(prompt, schema, "halden_na_v12_analysis");
}

function fallbackAnalyze(input = {}) {
  const hay = `${input.title || ""} ${input.ingress || ""} ${input.content || ""}`.toLowerCase();
  const local = /halden|tistedal|berg|idd|østfold|ostfold|kommune|dyrendal|svinesund/.test(hay);
  const score = local ? 6 : 4;

  return {
    worthy: score >= 6,
    score,
    kategori: guessCategory(hay),
    tema: input.title || "Mulig lokal sak",
    hovedpoeng: input.ingress || String(input.content || "").slice(0, 180),
    reason: "Fallback-vurdering uten OpenAI."
  };
}

function guessCategory(hay = "") {
  if (/kommune|regulering|høring|horing|offentlig ettersyn|planforslag/.test(hay)) return "Kommune";
  if (/trafikk|vei|ulykke|e6|svinesund/.test(hay)) return "Trafikk";
  if (/kamp|fotball|sport|vm/.test(hay)) return "Sport";
  if (/konsert|festival|arrangement/.test(hay)) return "Arrangement";
  if (/politi|politilogg/.test(hay)) return "Politilogg";
  return "Lokalt";
}

async function callOpenAIJson(prompt, schema, name) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: prompt,
      text: { format: { type: "json_schema", name, strict: true, schema } }
    })
  });

  if (!res.ok) throw new Error(`OpenAI svarte ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const text = data.output_text || data.output?.[0]?.content?.[0]?.text || "";
  return JSON.parse(text);
}

module.exports = { analyzeArticle, callOpenAIJson };
