/*
  HALDEN NÅ – V12
  04_ai_motor/clean-content.js

  Formål:
  Gjør rotete HTML/nettsider om til ren journalistisk tekst før AI får stoffet.

  Bruk:
    const { cleanContent } = require("./clean-content.js");
    const cleaned = cleanContent({ html, url, contentType });

  Returnerer:
    {
      ok,
      url,
      type,
      title,
      ingress,
      text,
      headings,
      wordCount,
      qualityScore,
      hashText,
      debug
    }
*/

const MAX_TEXT_LENGTH = 8000;
const MAX_HASH_LENGTH = 3000;

const NOISE_BLOCK_PATTERNS = [
  "script",
  "style",
  "noscript",
  "svg",
  "canvas",
  "iframe",
  "form",
  "input",
  "button",
  "select",
  "option",
  "textarea",
  "nav",
  "footer",
  "header",
  "aside"
];

const NOISE_ATTR_WORDS = [
  "cookie",
  "consent",
  "gdpr",
  "privacy",
  "annonse",
  "advert",
  "ad-",
  "ads",
  "banner",
  "promo",
  "promoted",
  "sponsor",
  "newsletter",
  "related",
  "relaterte",
  "share",
  "sharing",
  "social",
  "menu",
  "meny",
  "navigation",
  "breadcrumb",
  "breadcrumbs",
  "sidebar",
  "side-bar",
  "most-read",
  "mest-lest",
  "popular",
  "widget",
  "toolbar",
  "search",
  "sok",
  "skip",
  "login",
  "paywall",
  "subscribe"
];

const NOISE_TEXT_PATTERNS = [
  /^hopp til/i,
  /^gå til/i,
  /^meny$/i,
  /^søk$/i,
  /^logg inn$/i,
  /^abonner$/i,
  /^annonse$/i,
  /^annonser$/i,
  /^personvern$/i,
  /^kontakt oss$/i,
  /^til toppen$/i,
  /^del saken$/i,
  /^kopier lenke$/i,
  /^les også$/i,
  /^les mer$/i,
  /^relaterte saker$/i,
  /^sist oppdatert$/i,
  /^publisert:/i,
  /^oppdatert:/i,
  /^foto:/i,
  /^©/i,
  /^all rights reserved/i
];

const ARTICLE_HINTS = [
  "article",
  "main",
  "content",
  "story",
  "news",
  "nyhet",
  "body",
  "text",
  "tekst",
  "entry",
  "post",
  "page-content",
  "article-content",
  "story-content"
];

function cleanContent(input = {}) {
  const html = String(input.html || "");
  const url = String(input.url || "");
  const contentType = String(input.contentType || "").toLowerCase();

  if (!html.trim()) {
    return emptyResult(url, "Mangler HTML/tekst.");
  }

  const looksLikeXml = contentType.includes("xml") || /^\s*<\?xml/i.test(html) || /<rss[\s>]/i.test(html) || /<feed[\s>]/i.test(html);

  if (looksLikeXml) {
    return cleanXmlLikeContent(html, url, contentType);
  }

  const normalizedHtml = normalizeHtml(html);
  const title = extractTitle(normalizedHtml);
  const metaDescription = extractMetaDescription(normalizedHtml);

  const stripped = removeNoiseBlocks(normalizedHtml);
  const candidates = extractCandidateBlocks(stripped);
  const best = selectBestCandidate(candidates, title, metaDescription);

  const blockHtml = best?.html || stripped;
  const titleFromBlock = extractTitle(blockHtml) || firstHeading(blockHtml) || title;
  const lines = htmlBlockToLines(blockHtml);
  const filteredLines = filterUsefulLines(lines, titleFromBlock);

  const headings = extractHeadings(blockHtml);
  const ingress = findIngress(filteredLines, metaDescription, titleFromBlock);
  const text = buildBodyText(filteredLines, titleFromBlock, ingress);

  const finalTitle = cleanLine(titleFromBlock || firstUsefulLine(filteredLines) || "Uten tittel");
  const finalIngress = cleanLine(ingress || firstSentence(text, 180));
  const finalText = trimText(text || filteredLines.join("\n\n"), MAX_TEXT_LENGTH);
  const wordCount = countWords(`${finalTitle} ${finalIngress} ${finalText}`);
  const qualityScore = scoreQuality({
    title: finalTitle,
    ingress: finalIngress,
    text: finalText,
    wordCount,
    bestScore: best?.score || 0,
    url
  });

  return {
    ok: wordCount >= 40 && qualityScore >= 3,
    url,
    type: "html",
    title: finalTitle,
    ingress: finalIngress,
    text: finalText,
    headings,
    wordCount,
    qualityScore,
    hashText: trimText(`${finalTitle}\n${finalIngress}\n${finalText}`, MAX_HASH_LENGTH),
    debug: {
      contentType,
      candidates: candidates.length,
      selectedScore: best?.score || 0,
      selectedTag: best?.tag || "body"
    }
  };
}

function cleanXmlLikeContent(xml = "", url = "", contentType = "") {
  const title = decodeEntities(firstTag(xml, "title") || "RSS/feed");
  const description = decodeEntities(stripCdata(firstTag(xml, "description") || firstTag(xml, "summary") || ""));

  const items = [...xml.matchAll(/<(item|entry)[^>]*>([\s\S]*?)<\/\1>/gi)].slice(0, 12).map((match) => {
    const item = match[2];
    const itemTitle = cleanLine(decodeEntities(stripCdata(firstTag(item, "title"))));
    const itemDescription = cleanLine(htmlToPlainText(stripCdata(firstTag(item, "description") || firstTag(item, "summary") || firstTag(item, "content"))));
    const link = extractXmlLink(item) || url;
    const published = cleanLine(firstTag(item, "pubDate") || firstTag(item, "published") || firstTag(item, "updated"));

    return [itemTitle, itemDescription, published ? `Publisert: ${published}` : "", link ? `Lenke: ${link}` : ""]
      .filter(Boolean)
      .join("\n");
  }).filter(Boolean);

  const text = trimText(items.join("\n\n---\n\n"), MAX_TEXT_LENGTH);
  const wordCount = countWords(`${title} ${description} ${text}`);

  return {
    ok: items.length > 0,
    url,
    type: "feed",
    title: cleanLine(title),
    ingress: cleanLine(description || `${items.length} mulige saker funnet i feed.`),
    text,
    headings: [],
    wordCount,
    qualityScore: items.length ? 5 : 1,
    hashText: trimText(`${title}\n${description}\n${text}`, MAX_HASH_LENGTH),
    debug: {
      contentType,
      feedItems: items.length
    }
  };
}

function emptyResult(url, reason) {
  return {
    ok: false,
    url,
    type: "unknown",
    title: "",
    ingress: "",
    text: "",
    headings: [],
    wordCount: 0,
    qualityScore: 0,
    hashText: "",
    debug: { reason }
  };
}

function normalizeHtml(html = "") {
  return String(html)
    .replace(/\r/g, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ");
}

function removeNoiseBlocks(html = "") {
  let out = html;

  for (const tag of NOISE_BLOCK_PATTERNS) {
    const re = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi");
    out = out.replace(re, " ");
  }

  out = out.replace(/<[^>]+(?:class|id|role|aria-label)=["'][^"']*(?:cookie|consent|gdpr|annonse|advert|banner|promo|sponsor|newsletter|related|relaterte|sidebar|breadcrumb|navigation|menu|meny|share|social|login|paywall|subscribe)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, " ");

  // Fjern enkle selvstendige elementer med støy-attributter.
  out = out.replace(/<[^>]+(?:class|id|role|aria-label)=["'][^"']*(?:cookie|consent|gdpr|annonse|advert|banner|promo|sponsor|newsletter|related|relaterte|sidebar|breadcrumb|navigation|menu|meny|share|social|login|paywall|subscribe)[^"']*["'][^>]*>/gi, " ");

  return out;
}

function extractCandidateBlocks(html = "") {
  const candidates = [];
  const blockRegex = /<(article|main|section|div)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;

  while ((match = blockRegex.exec(html)) !== null) {
    const full = match[0];
    const tag = match[1].toLowerCase();
    const attrs = extractOpeningTagAttrs(full).toLowerCase();
    const plain = htmlToPlainText(full);
    const words = countWords(plain);

    if (words < 35) continue;

    let score = 0;
    if (tag === "article") score += 8;
    if (tag === "main") score += 6;
    if (tag === "section") score += 2;

    for (const hint of ARTICLE_HINTS) {
      if (attrs.includes(hint)) score += 3;
    }

    for (const noise of NOISE_ATTR_WORDS) {
      if (attrs.includes(noise)) score -= 5;
    }

    const paragraphCount = (full.match(/<p\b/gi) || []).length;
    const headingCount = (full.match(/<h[1-3]\b/gi) || []).length;
    const linkCount = (full.match(/<a\b/gi) || []).length;

    score += Math.min(paragraphCount, 8);
    score += Math.min(headingCount, 3);

    if (words > 80) score += 3;
    if (words > 200) score += 4;
    if (words > 1200) score -= 2;
    if (linkCount > paragraphCount * 2 && paragraphCount < 6) score -= 6;
    if (looksLikeDocumentList(plain)) score -= 5;

    candidates.push({ html: full, tag, score, words });
  }

  candidates.sort((a, b) => b.score - a.score);
  return dedupeCandidates(candidates).slice(0, 20);
}

function selectBestCandidate(candidates = [], title = "", metaDescription = "") {
  if (!candidates.length) return null;

  return candidates
    .map(candidate => {
      let score = candidate.score;
      const plain = htmlToPlainText(candidate.html).toLowerCase();
      const titleWords = cleanLine(title).toLowerCase().split(/\s+/).filter(w => w.length > 4);
      const metaWords = cleanLine(metaDescription).toLowerCase().split(/\s+/).filter(w => w.length > 5);

      for (const word of titleWords.slice(0, 8)) {
        if (plain.includes(word)) score += 1;
      }

      for (const word of metaWords.slice(0, 8)) {
        if (plain.includes(word)) score += 0.5;
      }

      return { ...candidate, score };
    })
    .sort((a, b) => b.score - a.score)[0];
}

function extractTitle(html = "") {
  const ogTitle = metaContent(html, "property", "og:title") || metaContent(html, "name", "twitter:title");
  const h1 = firstHeading(html, "h1");
  const titleTag = firstTag(html, "title");

  return cleanLine(ogTitle || h1 || titleTag || "").replace(/\s+[|–-]\s+[^|–-]{2,40}$/i, "");
}

function extractMetaDescription(html = "") {
  return cleanLine(
    metaContent(html, "name", "description") ||
    metaContent(html, "property", "og:description") ||
    metaContent(html, "name", "twitter:description") ||
    ""
  );
}

function metaContent(html = "", attrName = "name", attrValue = "") {
  const re = new RegExp(`<meta[^>]+${attrName}=["']${escapeRegExp(attrValue)}["'][^>]*content=["']([^"']*)["'][^>]*>|<meta[^>]+content=["']([^"']*)["'][^>]*${attrName}=["']${escapeRegExp(attrValue)}["'][^>]*>`, "i");
  const match = html.match(re);
  return match ? decodeEntities(match[1] || match[2] || "") : "";
}

function firstHeading(html = "", preferredTag = "") {
  if (preferredTag) {
    const preferred = firstTag(html, preferredTag);
    if (preferred) return htmlToPlainText(preferred);
  }

  const match = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
  return match ? htmlToPlainText(match[1]) : "";
}

function extractHeadings(html = "") {
  return [...html.matchAll(/<h[2-3][^>]*>([\s\S]*?)<\/h[2-3]>/gi)]
    .map(m => cleanLine(htmlToPlainText(m[1])))
    .filter(h => h.length > 2 && h.length < 140)
    .slice(0, 12);
}

function htmlBlockToLines(html = "") {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/section>/gi, "\n")
    .replace(/<\/article>/gi, "\n");

  return htmlToPlainText(withBreaks)
    .split(/\n+/)
    .map(cleanLine)
    .filter(Boolean);
}

function filterUsefulLines(lines = [], title = "") {
  const seen = new Set();
  const titleClean = cleanLine(title).toLowerCase();

  return lines.filter(line => {
    const clean = cleanLine(line);
    const lower = clean.toLowerCase();

    if (!clean) return false;
    if (clean.length < 25 && !/[.!?]$/.test(clean)) return false;
    if (clean.length > 1200) return false;
    if (lower === titleClean) return false;
    if (NOISE_TEXT_PATTERNS.some(re => re.test(clean))) return false;
    if (isMostlyNavigation(clean)) return false;
    if (isFileOnlyLine(clean)) return false;

    const key = lower.replace(/[^a-zæøå0-9]/gi, "").slice(0, 140);
    if (seen.has(key)) return false;
    seen.add(key);

    return true;
  });
}

function findIngress(lines = [], metaDescription = "", title = "") {
  const meta = cleanLine(metaDescription);
  if (meta.length >= 45 && meta.length <= 280 && !isMostlyNavigation(meta)) return meta;

  const titleLower = cleanLine(title).toLowerCase();

  return lines.find(line => {
    const clean = cleanLine(line);
    if (clean.toLowerCase() === titleLower) return false;
    if (clean.length < 45 || clean.length > 280) return false;
    if (isMostlyNavigation(clean)) return false;
    return true;
  }) || "";
}

function buildBodyText(lines = [], title = "", ingress = "") {
  const titleLower = cleanLine(title).toLowerCase();
  const ingressLower = cleanLine(ingress).toLowerCase();

  const bodyLines = lines.filter(line => {
    const lower = cleanLine(line).toLowerCase();
    if (lower === titleLower) return false;
    if (lower === ingressLower) return false;
    return true;
  });

  const paragraphs = bodyLines
    .filter(line => line.length >= 35 || /[.!?]$/.test(line))
    .slice(0, 30);

  return trimText(paragraphs.join("\n\n"), MAX_TEXT_LENGTH);
}

function htmlToPlainText(html = "") {
  return decodeEntities(
    String(html)
      .replace(/<[^>]*>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n+ */g, "\n")
  ).trim();
}

function cleanLine(value = "") {
  return decodeEntities(String(value))
    .replace(/\s+/g, " ")
    .replace(/^[•\-–—·|:;,.\s]+/, "")
    .replace(/[|:;,.\s]+$/, "")
    .trim();
}

function decodeEntities(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#039;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&aring;/gi, "å")
    .replace(/&oslash;/gi, "ø")
    .replace(/&aelig;/gi, "æ")
    .replace(/&Aring;/g, "Å")
    .replace(/&Oslash;/g, "Ø")
    .replace(/&AElig;/g, "Æ")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : " ";
    });
}

function firstTag(html = "", tag = "") {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = String(html).match(re);
  return match ? match[1] : "";
}

function stripCdata(value = "") {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function extractXmlLink(item = "") {
  const plainLink = firstTag(item, "link");
  if (plainLink && !plainLink.includes("<")) return cleanLine(plainLink);

  const hrefMatch = item.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  if (hrefMatch) return hrefMatch[1];

  const guid = firstTag(item, "guid");
  if (/^https?:\/\//i.test(guid)) return cleanLine(guid);

  return "";
}

function extractOpeningTagAttrs(html = "") {
  const match = String(html).match(/^<[^\s>]+([^>]*)>/);
  return match ? match[1] : "";
}

function firstUsefulLine(lines = []) {
  return lines.find(line => line.length >= 25 && line.length <= 180) || "";
}

function firstSentence(text = "", max = 180) {
  const clean = cleanLine(text);
  const sentence = clean.split(/(?<=[.!?])\s+/)[0] || clean;
  return trimText(sentence, max);
}

function trimText(text = "", max = 1000) {
  const clean = String(text).trim();
  return clean.length > max ? clean.slice(0, max).trim() + "..." : clean;
}

function countWords(text = "") {
  return (String(text).match(/[A-Za-zÆØÅæøå0-9]{2,}/g) || []).length;
}

function looksLikeDocumentList(text = "") {
  const lower = text.toLowerCase();
  const fileHits = (lower.match(/\b(pdf|docx|xlsx|pptx)\b/g) || []).length;
  const attachmentHits = (lower.match(/\b(vedlegg|dokument|last ned|referat|saksframlegg)\b/g) || []).length;
  return fileHits >= 4 || attachmentHits >= 8;
}

function isMostlyNavigation(line = "") {
  const lower = line.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  if (!words.length) return true;

  const navHits = words.filter(word => [
    "meny",
    "søk",
    "hjem",
    "kontakt",
    "personvern",
    "logg",
    "inn",
    "abonner",
    "nyheter",
    "sport",
    "kultur",
    "annonse",
    "tips",
    "deling",
    "facebook",
    "instagram",
    "twitter",
    "x"
  ].includes(word)).length;

  if (words.length <= 8 && navHits >= 2) return true;
  if (line.includes(" | ") && words.length <= 14) return true;
  return false;
}

function isFileOnlyLine(line = "") {
  const lower = line.toLowerCase();
  if (/\.(pdf|docx|xlsx|pptx)\b/.test(lower) && line.length < 160) return true;
  if (/^(pdf|docx|xlsx|pptx)\b/i.test(line)) return true;
  return false;
}

function scoreQuality({ title, ingress, text, wordCount, bestScore, url }) {
  let score = 0;
  const hay = `${title} ${ingress} ${text}`.toLowerCase();

  if (title && title.length >= 8) score += 1;
  if (ingress && ingress.length >= 45) score += 1;
  if (wordCount >= 80) score += 2;
  if (wordCount >= 180) score += 2;
  if (bestScore >= 8) score += 2;
  if (hay.includes("halden")) score += 1;
  if (/høring|offentlig ettersyn|regulering|kommune|politiet|brann|trafikk|arrangement/i.test(hay)) score += 1;
  if (looksLikeDocumentList(hay)) score -= 2;
  if (/cookie|hopp til innhold|personverninnstillinger/i.test(hay)) score -= 2;
  if (url && /nrk\.no|halden\.kommune\.no|politiet\.no|vegvesen\.no/i.test(url)) score += 1;

  return Math.max(0, Math.min(10, score));
}

function dedupeCandidates(candidates = []) {
  const seen = new Set();
  return candidates.filter(candidate => {
    const key = cleanLine(htmlToPlainText(candidate.html)).toLowerCase().replace(/[^a-zæøå0-9]/gi, "").slice(0, 180);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  cleanContent,
  cleanHtmlContent: cleanContent,
  htmlToPlainText,
  cleanLine,
  decodeEntities
};
