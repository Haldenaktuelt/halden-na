const cheerio = require("cheerio");
const { cleanText } = require("./clean-content.js");

const DOCUMENT_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".doc",
  ".xlsx",
  ".xls"
];

function extractDocumentLinks(input = {}) {
  const html = input.html || "";
  const baseUrl = input.url || "";
  const sourceName = input.sourceName || "";
  const instruction = input.instruction || "";
  const maxDocuments = Number(input.maxDocuments || 12);

  if (!html || !baseUrl) return [];

  const $ = cheerio.load(html);
  const documents = [];

  $("a[href]").each((_, el) => {
    const href = String($(el).attr("href") || "").trim();
    const text = cleanText($(el).text());
    const title = text || cleanText($(el).attr("title")) || href;
    const url = absoluteUrl(href, baseUrl);

    if (!url) return;

    const type = detectDocumentType(url, title);
    if (!type) return;

    const score = scoreDocument({
      url,
      title,
      type,
      sourceName,
      instruction
    });

    documents.push({
      url,
      title: trimText(title, 180),
      type,
      score
    });
  });

  return dedupeDocuments(documents)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxDocuments);
}

function detectDocumentType(url = "", title = "") {
  const lower = `${url} ${title}`.toLowerCase();

  for (const ext of DOCUMENT_EXTENSIONS) {
    if (lower.includes(ext)) return ext.replace(".", "");
  }

  if (/(pdf|docx|word|excel|vedlegg|saksframlegg|planbeskrivelse|plankart|bestemmelser)/i.test(lower)) {
    if (lower.includes("pdf")) return "pdf";
    if (lower.includes("docx") || lower.includes("word")) return "docx";
    if (lower.includes("xlsx") || lower.includes("excel")) return "xlsx";
    return "document";
  }

  return "";
}

function scoreDocument(doc = {}) {
  const hay = `${doc.url || ""} ${doc.title || ""} ${doc.sourceName || ""} ${doc.instruction || ""}`.toLowerCase();
  let score = 0;

  if (doc.type === "pdf") score += 4;
  if (doc.type === "docx" || doc.type === "doc") score += 3;
  if (doc.type === "xlsx" || doc.type === "xls") score += 1;

  const important = [
    "saksframlegg",
    "saksfremlegg",
    "planbeskrivelse",
    "bestemmelser",
    "plankart",
    "referat",
    "høring",
    "horing",
    "offentlig ettersyn",
    "detaljregulering",
    "reguleringsplan",
    "planforslag",
    "varsling",
    "oppstart",
    "merknad",
    "innspill",
    "dyrendal",
    "halden"
  ];

  for (const word of important) {
    if (hay.includes(word)) score += 3;
  }

  const weak = [
    "illustrasjon",
    "bilde",
    "logo",
    "skjema",
    "ros-analyse",
    "teknisk",
    "vedlegg"
  ];

  for (const word of weak) {
    if (hay.includes(word)) score += 1;
  }

  const bad = [
    "personvern",
    "tilgjengelighet",
    "cookies",
    "kontakt",
    "facebook",
    "instagram"
  ];

  for (const word of bad) {
    if (hay.includes(word)) score -= 8;
  }

  return score;
}

function absoluteUrl(href = "", baseUrl = "") {
  try {
    return new URL(href, baseUrl).toString().split("#")[0];
  } catch {
    return "";
  }
}

function dedupeDocuments(documents = []) {
  const seen = new Set();

  return documents.filter(doc => {
    const key = normalizeUrl(doc.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeUrl(url = "") {
  return String(url || "")
    .split("#")[0]
    .replace(/\/$/, "")
    .trim();
}

function trimText(text = "", max = 1000) {
  const clean = cleanText(text);
  return clean.length > max ? clean.slice(0, max).trim() + "..." : clean;
}

module.exports = {
  extractDocumentLinks,
  detectDocumentType
};
