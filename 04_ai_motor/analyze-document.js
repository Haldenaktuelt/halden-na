const { callOpenAIJson } = require("./ai-analyze.js");

async function analyzeDocument(input = {}) {
  const {
    title = "",
    text = "",
    url = "",
    sourceName = "",
    instruction = "",
    type = "pdf"
  } = input;

  if (!process.env.OPENAI_API_KEY) {
    return fallbackDocumentAnalysis(input);
  }

  const prompt = `
Du er dokumentanalytiker for lokalavisen HALDEN NÅ.

Du skal analysere et kommunalt dokument og trekke ut hva saken egentlig handler om.
Du skal IKKE skrive artikkel nå.

VIKTIG:
Ignorer arkivstøy:
- arkivkode
- arkivsaksnummer
- journalnummer
- saksbehandler
- møtedato
- dokumentnummer
- PDF-størrelse
- sidehoder og bunntekster

Finn heller:
- hva saken gjelder
- hvor i Halden det gjelder
- hva kommunen foreslår/varsler/behandler
- om det er høring/offentlig ettersyn
- eventuell frist
- hvem som kan bli berørt
- hvorfor dette er interessant for folk flest
- hva innbyggere eventuelt kan gjøre

Svar KUN som JSON.

Kilde: ${sourceName}
Dokumenttype: ${type}
URL: ${url}
Redaksjonsinstruks: ${instruction}

Dokumenttittel:
${title}

Dokumenttekst:
${trimForPrompt(text, 6500)}
`;

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      isNewsworthy: { type: "boolean" },
      score: { type: "number" },
      category: { type: "string" },
      topic: { type: "string" },
      location: { type: "string" },
      documentType: { type: "string" },
      proposal: { type: "string" },
      importance: { type: "string" },
      deadline: { type: "string" },
      publicAction: { type: "string" },
      affectedPeople: { type: "string" },
      keyFacts: {
        type: "array",
        items: { type: "string" }
      },
      suggestedTitle: { type: "string" },
      suggestedIngress: { type: "string" },
      reason: { type: "string" }
    },
    required: [
      "isNewsworthy",
      "score",
      "category",
      "topic",
      "location",
      "documentType",
      "proposal",
      "importance",
      "deadline",
      "publicAction",
      "affectedPeople",
      "keyFacts",
      "suggestedTitle",
      "suggestedIngress",
      "reason"
    ]
  };

  return await callOpenAIJson(prompt, schema, "halden_na_v14_3_document_analysis");
}

function fallbackDocumentAnalysis(input = {}) {
  const text = `${input.title || ""}\n${input.text || ""}`;
  const hay = text.toLowerCase();

  const location =
    findFirst(text, ["Dyrendal", "Tistedal", "Halden sentrum", "Svinesund", "Idd", "Berg", "Brødløs"]) ||
    "Halden";

  const deadline = findDeadline(text);

  const category = /høring|offentlig ettersyn|regulering|planforslag|detaljregulering/i.test(text)
    ? "Kommune"
    : "Lokalt";

  const topic =
    cleanLine(input.title || "") ||
    (hay.includes("detaljregulering") ? "Ny reguleringssak i Halden" : "Kommunal sak i Halden");

  return {
    isNewsworthy: true,
    score: 6,
    category,
    topic,
    location,
    documentType: input.type || "pdf",
    proposal: firstUsefulSentence(text) || "Kommunen behandler en sak som kan være relevant lokalt.",
    importance: "Saken kan være relevant for innbyggere som berøres av planer, høringer eller kommunale vedtak.",
    deadline,
    publicAction: deadline ? "Innbyggere kan sende innspill innen fristen." : "Innbyggere kan lese saken og eventuelt sende innspill dersom saken er på høring.",
    affectedPeople: "Innbyggere og berørte i området.",
    keyFacts: [firstUsefulSentence(text)].filter(Boolean),
    suggestedTitle: topic,
    suggestedIngress: `${location}: Kommunen har en sak til behandling som kan være relevant for innbyggere i området.`,
    reason: "Fallback dokumentanalyse uten OpenAI."
  };
}

function trimForPrompt(value = "", max = 6500) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max).trim() + "..." : clean;
}

function cleanLine(value = "", max = 120) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\.pdf|\.docx|\.doc|\.xlsx/gi, "")
    .trim()
    .slice(0, max)
    .trim();
}

function firstUsefulSentence(text = "") {
  const sentences = String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 45 && s.length < 260)
    .filter(s => !/(arkivkode|arkivsak|journal|saksbehandler|møtedato|side \d+)/i.test(s));

  return sentences[0] || "";
}

function findFirst(text = "", words = []) {
  const lower = text.toLowerCase();

  for (const word of words) {
    if (lower.includes(word.toLowerCase())) return word;
  }

  return "";
}

function findDeadline(text = "") {
  const match = String(text || "").match(/(\d{1,2}\.\s?\d{1,2}\.\s?\d{4}|\d{4}-\d{2}-\d{2})/);
  return match ? match[1].replace(/\s+/g, "") : "";
}

module.exports = { analyzeDocument };
