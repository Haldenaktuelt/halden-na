const { callOpenAIJson } = require("./ai-analyze.js");

async function analyzeDocument(input = {}) {
  const { title = "", text = "", url = "", sourceName = "", instruction = "", type = "pdf" } = input;

  if (!process.env.OPENAI_API_KEY) return fallbackDocumentAnalysis(input);

  const prompt = `
Du er kommunedokument-analytiker for lokalavisen HALDEN NÅ.

Du skal forstå dokumentet redaksjonelt, ikke skrive artikkel.

Ignorer:
- arkivkode, arkivsaksnummer, journalnummer
- møtedato, dokumentnummer, saksbehandler
- PDF-størrelse, sidehoder/bunntekster
- postadresse, organisasjonsnummer og tekniske felt

Finn:
- hva saken gjelder
- hvor i Halden saken gjelder
- hva som foreslås eller behandles
- om det er høring/offentlig ettersyn
- frist hvis den finnes
- hvem saken kan påvirke
- hvorfor dette betyr noe lokalt
- hva innbyggere kan gjøre

Ikke bruk teknisk PDF-tittel som nyhetstittel.
Lag tittel og ingress slik en lokalavis ville gjort.
Svar KUN som JSON.

Kilde: ${sourceName}
Dokumenttype: ${type}
URL: ${url}
Redaksjonsinstruks: ${instruction}

Dokumenttittel:
${title}

Dokumenttekst:
${trimForPrompt(text, 7000)}
`;

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      isNewsworthy: { type: "boolean" },
      score: { type: "number" },
      category: { type: "string" },
      localAngle: { type: "string" },
      topic: { type: "string" },
      location: { type: "string" },
      caseType: { type: "string" },
      proposal: { type: "string" },
      status: { type: "string" },
      importance: { type: "string" },
      deadline: { type: "string" },
      publicAction: { type: "string" },
      affectedPeople: { type: "string" },
      plainLanguageExplanation: { type: "string" },
      keyFacts: { type: "array", items: { type: "string" } },
      suggestedTitle: { type: "string" },
      suggestedIngress: { type: "string" },
      avoidInArticle: { type: "array", items: { type: "string" } },
      reason: { type: "string" }
    },
    required: ["isNewsworthy","score","category","localAngle","topic","location","caseType","proposal","status","importance","deadline","publicAction","affectedPeople","plainLanguageExplanation","keyFacts","suggestedTitle","suggestedIngress","avoidInArticle","reason"]
  };

  const analysis = await callOpenAIJson(prompt, schema, "halden_na_v14_4_document_analysis");

  return {
    ...analysis,
    category: normalizeCategory(analysis.category),
    suggestedTitle: cleanGeneratedTitle(analysis.suggestedTitle),
    suggestedIngress: cleanLine(analysis.suggestedIngress, 220)
  };
}

function fallbackDocumentAnalysis(input = {}) {
  const text = `${input.title || ""}\n${input.text || ""}`;
  const location = findFirst(text, ["Dyrendal", "Tistedal", "Halden sentrum", "Svinesund", "Idd", "Berg", "Brødløs"]) || "Halden";
  const deadline = findDeadline(text);
  const isHearing = /høring|horing|offentlig ettersyn|innspill|merknad/i.test(text);
  const isPlan = /detaljregulering|reguleringsplan|planforslag|planbeskrivelse/i.test(text);

  return {
    isNewsworthy: true,
    score: 6,
    category: "Kommune",
    localAngle: `Saken gjelder ${location} og kan være relevant for innbyggere i området.`,
    topic: isPlan ? `Plansak i ${location}` : "Kommunal sak i Halden",
    location,
    caseType: isPlan ? "Plan- og reguleringssak" : "Kommunal sak",
    proposal: firstUsefulSentence(text) || "Kommunen behandler en sak som kan være relevant lokalt.",
    status: isHearing ? "Saken ser ut til å være på høring eller offentlig ettersyn." : "Saken er til kommunal behandling.",
    importance: "Saken kan være relevant for innbyggere som berøres av planer, høringer eller kommunale vedtak.",
    deadline,
    publicAction: deadline ? `Innbyggere kan sende innspill innen ${deadline}.` : "Innbyggere kan lese saken og følge videre behandling.",
    affectedPeople: "Innbyggere og berørte i området.",
    plainLanguageExplanation: "Dette er en kommunal sak som handler om planer eller behandling av et lokalt område.",
    keyFacts: [firstUsefulSentence(text)].filter(Boolean),
    suggestedTitle: isHearing ? `Kommunal plansak i ${location} er ute på høring` : `Kommunen behandler ny sak i ${location}`,
    suggestedIngress: `${location}: Kommunen behandler en sak som kan få betydning for området.`,
    avoidInArticle: ["arkivkode", "journalnummer", "PDF-størrelse", "saksbehandler"],
    reason: "Fallback dokumentanalyse uten OpenAI."
  };
}

function normalizeCategory(value = "") {
  const allowed = ["Lokalt","Politilogg","Kommune","Arrangement","Trafikk","Sport","Norge & Verden","Kultur","Meninger","Historie","Kort forklart","Tips"];
  return allowed.includes(value) ? value : "Kommune";
}

function cleanGeneratedTitle(value = "") {
  let title = cleanLine(value, 110);
  if (!title || /(saksfremlegg|saksframlegg|protokoll|pdf|kb\b|mb\b|arkiv|journal|vedlegg)/i.test(title)) {
    title = "Kommunal sak i Halden forklart enkelt";
  }
  return title;
}

function trimForPrompt(value = "", max = 7000) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max).trim() + "..." : clean;
}

function cleanLine(value = "", max = 160) {
  return String(value || "").replace(/\s+/g, " ").replace(/\.pdf|\.docx|\.doc|\.xlsx/gi, "").replace(/\(pdf[^)]*\)/gi, "").trim().slice(0, max).trim();
}

function firstUsefulSentence(text = "") {
  const sentences = String(text || "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 45 && s.length < 260).filter(s => !/(arkivkode|arkivsak|journal|saksbehandler|møtedato|side \d+|pdf|kb\b)/i.test(s));
  return sentences[0] || "";
}

function findFirst(text = "", words = []) {
  const lower = text.toLowerCase();
  for (const word of words) if (lower.includes(word.toLowerCase())) return word;
  return "";
}

function findDeadline(text = "") {
  const patterns = [/frist[^.:\n]{0,40}(\d{1,2}\.\s?\d{1,2}\.\s?\d{4})/i, /innen[^.:\n]{0,40}(\d{1,2}\.\s?\d{1,2}\.\s?\d{4})/i, /(\d{1,2}\.\s?\d{1,2}\.\s?\d{4})/];
  for (const rx of patterns) {
    const match = String(text || "").match(rx);
    if (match) return match[1].replace(/\s+/g, "");
  }
  return "";
}

module.exports = { analyzeDocument };
