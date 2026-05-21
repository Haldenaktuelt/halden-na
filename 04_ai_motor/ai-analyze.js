// HALDEN NÅ – V12
// 04_ai_motor/ai-analyze.js
//
// Formål:
// Vurdere om renset innhold faktisk er verdt å gjøre om til en kladd.
// Denne modulen skriver IKKE artikkel. Den analyserer bare nyhetsverdi,
// lokal relevans, kategori og kvalitet.

const DEFAULT_MODEL = "gpt-4o-mini";

const VALID_CATEGORIES = [
  "Lokalt",
  "Kommune",
  "Arrangement",
  "Politilogg",
  "Trafikk",
  "Sport",
  "Norge & Verden",
  "Kultur",
  "Meninger",
  "Historie"
];

function safeString(value = "") {
  return String(value || "").trim();
}

function clampNumber(value, min, max, fallback = 0) {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeCategory(category = "") {
  const clean = safeString(category);
  return VALID_CATEGORIES.includes(clean) ? clean : "Lokalt";
}

function buildArticleText(input = {}) {
  const title = safeString(input.title || input.tittel);
  const ingress = safeString(input.ingress || input.lead);
  const text = safeString(input.text || input.tekst || input.content || input.bodyText);
  const sourceUrl = safeString(input.sourceUrl || input.url);

  return [
    title ? `TITTEL:\n${title}` : "",
    ingress ? `INGRESS:\n${ingress}` : "",
    text ? `TEKST:\n${text}` : "",
    sourceUrl ? `KILDE_URL:\n${sourceUrl}` : ""
  ].filter(Boolean).join("\n\n");
}

function localHeuristicAnalyze(input = {}) {
  const title = safeString(input.title || input.tittel);
  const ingress = safeString(input.ingress || input.lead);
  const text = safeString(input.text || input.tekst || input.content || input.bodyText);
  const url = safeString(input.sourceUrl || input.url).toLowerCase();
  const all = `${title} ${ingress} ${text} ${url}`.toLowerCase();

  const wordCount = text.split(/\s+/).filter(Boolean).length;

  let score = 0;
  let category = "Lokalt";
  const reasons = [];

  if (title.length > 12) score += 1;
  if (ingress.length > 40) score += 1;
  if (wordCount >= 80) score += 2;
  if (wordCount >= 180) score += 1;

  if (/halden|tistedal|berg|rokke|asak|idd|enningdal|sponvika|østfold|ostfold/.test(all)) {
    score += 2;
    reasons.push("Har lokal relevans for Halden/Østfold.");
  }

  if (/kommune|kommunestyre|formannskap|høring|regulering|byggesak|plan|skole|barnehage|helse|dyrendal/.test(all)) {
    category = "Kommune";
    score += 1;
  }

  if (/politi|nødetat|brann|ulykke|trafikkulykke|pågrepet|savnet|politiloggen/.test(all)) {
    category = "Politilogg";
    score += 1;
  }

  if (/vei|trafikk|e6|rv|fv|stengt|kø|omkjøring|vegvesen/.test(all)) {
    category = "Trafikk";
    score += 1;
  }

  if (/konsert|festival|arrangement|forestilling|marked|åpning|utstilling/.test(all)) {
    category = "Arrangement";
    score += 1;
  }

  if (/fotball|håndball|sport|kamp|turnering|vm|halden topphåndball/.test(all)) {
    category = "Sport";
    score += 1;
  }

  if (/cookie|personvern|logg inn|abonner|annonse|meny|footer|javascript/.test(all)) {
    score -= 2;
    reasons.push("Innholdet kan inneholde sidestøy.");
  }

  if (wordCount < 50 && !title) {
    score -= 3;
    reasons.push("For lite innhold til å lage trygg kladd.");
  }

  const normalizedScore = clampNumber(score, 0, 10, 0);
  const worthy = normalizedScore >= 5;

  return {
    ok: true,
    fallback: true,
    worthy,
    score: normalizedScore,
    kategori: category,
    reason: reasons.length ? reasons.join(" ") : worthy
      ? "Ser ut som en mulig nyhetssak med nok innhold til videre behandling."
      : "For svakt eller uklart innhold til å lage kladd automatisk.",
    risks: worthy ? [] : ["Må vurderes manuelt før eventuell kladd."],
    summary: ingress || title || text.slice(0, 180),
    localRelevance: /halden|tistedal|berg|rokke|asak|idd|enningdal|sponvika/.test(all) ? "high" : "medium",
    shouldWriteDraft: worthy
  };
}

function extractJson(text = "") {
  const clean = safeString(text);

  try {
    return JSON.parse(clean);
  } catch (_) {
    // Fortsetter under
  }

  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch (_) {
    return null;
  }
}

function normalizeAiAnalysis(raw = {}, fallback = {}) {
  const score = clampNumber(raw.score, 0, 10, fallback.score || 0);
  const kategori = normalizeCategory(raw.kategori || raw.category || fallback.kategori);
  const worthy = typeof raw.worthy === "boolean"
    ? raw.worthy
    : typeof raw.shouldWriteDraft === "boolean"
      ? raw.shouldWriteDraft
      : score >= 6;

  return {
    ok: true,
    fallback: false,
    worthy,
    score,
    kategori,
    reason: safeString(raw.reason || raw.begrunnelse || fallback.reason),
    risks: Array.isArray(raw.risks) ? raw.risks.map(safeString).filter(Boolean) : [],
    summary: safeString(raw.summary || raw.sammendrag || fallback.summary),
    localRelevance: safeString(raw.localRelevance || raw.lokalRelevans || fallback.localRelevance || "medium"),
    shouldWriteDraft: worthy && score >= 6
  };
}

function buildAnalyzePrompt(input = {}) {
  const articleText = buildArticleText(input);

  return `Du er redaksjonell vurderingsmotor for lokalavisen HALDEN NÅ.

Du skal IKKE skrive artikkel.
Du skal kun avgjøre om innholdet er godt nok til at en egen skrive-modul kan lage kladd.

Vurder etter disse kriteriene:
1. Er dette en faktisk nyhet eller bare sidestøy?
2. Har det lokal relevans for Halden, Østfold eller nærområdet?
3. Er det nok konkret informasjon til å lage en trygg kladd?
4. Er saken folkelig interessant?
5. Hvilken HALDEN NÅ-kategori passer best?

Gyldige kategorier:
${VALID_CATEGORIES.join(", ")}

Svar KUN som gyldig JSON. Ikke markdown.

Format:
{
  "worthy": true,
  "score": 0,
  "kategori": "Lokalt",
  "reason": "Kort begrunnelse",
  "risks": [],
  "summary": "Kort redaksjonelt sammendrag",
  "localRelevance": "high|medium|low",
  "shouldWriteDraft": true
}

Regler:
- score 0-10
- under 6 skal normalt ikke skrives til kladd
- hvis innholdet virker som meny/footer/cookie/dokumentliste uten sak: worthy=false
- hvis teksten er for tynn eller uklar: worthy=false
- ikke overdriv lokal relevans
- ikke finn på fakta

INNHOLD SOM SKAL VURDERES:
${articleText.slice(0, 12000)}`;
}

export async function analyzeArticle(input = {}, options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  const model = options.model || process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const fallback = localHeuristicAnalyze(input);

  if (!apiKey) {
    return fallback;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.15,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Du er en streng redaksjonell filtermotor for en lokalavis. Du svarer kun med JSON."
          },
          {
            role: "user",
            content: buildAnalyzePrompt(input)
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI analyze svarte ${response.status}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || "";
    const parsed = extractJson(content);

    if (!parsed) {
      throw new Error("Kunne ikke lese JSON fra AI-analyse");
    }

    return normalizeAiAnalysis(parsed, fallback);
  } catch (err) {
    console.warn("AI-analyse feilet, bruker lokal vurdering:", err.message);
    return fallback;
  }
}

export function shouldWriteDraft(analysis = {}) {
  return analysis?.worthy === true && Number(analysis?.score || 0) >= 6;
}

export function getValidCategories() {
  return [...VALID_CATEGORIES];
}

export default analyzeArticle;
