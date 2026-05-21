const pdfParse = require("pdf-parse");
const { cleanText, trimText } = require("./clean-content.js");

const DOCUMENT_TIMEOUT_MS = 10000;
const MAX_DOCUMENT_CHARS = 9000;

async function fetchDocumentText(input = {}) {
  const url = input.url || "";
  const title = input.title || "";
  const type = String(input.type || detectTypeFromUrl(url)).toLowerCase();

  if (!url) {
    return {
      ok: false,
      error: "Mangler dokument-URL.",
      url,
      title,
      type
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOCUMENT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "HaldenNaaDokumentleser/1.1 kontakt:redaksjon@halden-naa.no",
        "Accept": "application/pdf,application/octet-stream,*/*"
      }
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Dokument svarte ${res.status}`);
    }

    const contentLength = Number(res.headers.get("content-length") || 0);
    if (contentLength && contentLength > 8 * 1024 * 1024) {
      return {
        ok: false,
        skipped: true,
        reason: "Dokumentet er for stort for rask lokal lesing.",
        url,
        title,
        type,
        contentLength
      };
    }

    const contentType = res.headers.get("content-type") || "";
    const buffer = Buffer.from(await res.arrayBuffer());
    const detectedType = type || detectTypeFromContentType(contentType) || detectTypeFromUrl(url);

    if (detectedType === "pdf") {
      return await readPdf({
        url,
        title,
        type: "pdf",
        buffer,
        contentType
      });
    }

    return {
      ok: false,
      skipped: true,
      reason: `Dokumenttype støttes ikke ennå: ${detectedType || "ukjent"}`,
      url,
      title,
      type: detectedType || "unknown",
      contentType
    };
  } catch (error) {
    clearTimeout(timeout);

    return {
      ok: false,
      error: error.name === "AbortError"
        ? "Dokumentlesing tok for lang tid og ble stoppet."
        : error.message,
      url,
      title,
      type
    };
  }
}

async function readPdf({ url, title, type, buffer, contentType }) {
  try {
    const parsed = await pdfParse(buffer, {
      max: 10
    });

    const rawText = parsed.text || "";
    let text = cleanDocumentText(rawText);

    if (text.length > MAX_DOCUMENT_CHARS) {
      text = text.slice(0, MAX_DOCUMENT_CHARS).trim();
    }

    if (!text || text.length < 120) {
      return {
        ok: false,
        skipped: true,
        reason: "PDF ble lest, men inneholdt for lite tekst.",
        url,
        title,
        type,
        contentType,
        pages: parsed.numpages || 0,
        text: ""
      };
    }

    return {
      ok: true,
      url,
      title,
      type,
      contentType,
      pages: parsed.numpages || 0,
      info: parsed.info || {},
      text,
      content: text,
      excerpt: trimText(text, 900)
    };
  } catch (error) {
    return {
      ok: false,
      error: `PDF-lesing feilet: ${error.message}`,
      url,
      title,
      type,
      contentType
    };
  }
}

function cleanDocumentText(value = "") {
  let text = cleanText(value)
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  const lines = text
    .split(/\n+/)
    .map(line => cleanText(line))
    .filter(Boolean)
    .filter(line => !isNoiseLine(line));

  return dedupeLines(lines).join("\n\n").trim();
}

function isNoiseLine(line = "") {
  const lower = String(line || "").toLowerCase();

  if (line.length < 3) return true;

  const noise = [
    "side ",
    "page ",
    "halden kommune",
    "postadresse",
    "telefon",
    "organisasjonsnummer",
    "www.halden.kommune.no",
    "e-post",
    "epost"
  ];

  if (noise.some(word => lower === word || lower.startsWith(word))) return true;
  if (/^\d+$/.test(line.trim())) return true;

  return false;
}

function dedupeLines(lines = []) {
  const seen = new Set();
  const out = [];

  for (const line of lines) {
    const key = line.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }

  return out;
}

function detectTypeFromUrl(url = "") {
  const lower = String(url).toLowerCase();
  if (lower.includes(".pdf")) return "pdf";
  if (lower.includes(".docx")) return "docx";
  if (lower.includes(".doc")) return "doc";
  if (lower.includes(".xlsx")) return "xlsx";
  return "";
}

function detectTypeFromContentType(contentType = "") {
  const lower = String(contentType).toLowerCase();
  if (lower.includes("pdf")) return "pdf";
  if (lower.includes("wordprocessingml")) return "docx";
  if (lower.includes("msword")) return "doc";
  if (lower.includes("spreadsheetml")) return "xlsx";
  return "";
}

module.exports = {
  fetchDocumentText,
  cleanDocumentText
};
