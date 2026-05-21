/*
  HALDEN NÅ – V12
  04_ai_motor/detect-feed.js

  Formål:
  Finner ut hva slags kilde/side vi har før AI-pipelinen jobber videre.

  Bruk:
    const { detectFeed } = require("./detect-feed.js");
    const detected = detectFeed({ url, html, contentType });

  Returnerer typisk:
    {
      ok: true,
      url,
      hostname,
      sourceType: "rss_feed" | "atom_feed" | "nrk_frontpage" | "frontpage" |
                  "article" | "pdf" | "document_page" | "document_list" |
                  "listing_page" | "unknown",
      kind: "feed" | "frontpage" | "article" | "document" | "list" | "unknown",
      shouldExtractLinks: true/false,
      shouldCleanDirect: true/false,
      shouldFetchAsDocument: true/false,
      candidateFeedUrls: [],
      confidence: 0-10,
      reason: "...",
      debug: {}
    }

  Viktig:
  Denne filen skriver IKKE saker og bruker IKKE AI.
  Den bestemmer bare riktig behandlingsløp.
*/

let cheerio = null;
try {
  cheerio = require("cheerio");
} catch (err) {
  cheerio = null;
}

const FEED_CONTENT_TYPES = [
  "application/rss+xml",
  "application/atom+xml",
  "application/xml",
  "text/xml"
];

const DOCUMENT_EXTENSIONS = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"];

const FRONT_PAGE_HINTS = [
  "/",
  "/ostfold",
  "/nyheter",
  "/lokalt",
  "/sport",
  "/kultur",
  "/aktuelt",
  "/kunngjoringer-og-horinger",
  "/kunngjoringer",
  "/horinger",
  "/politiloggen"
];

function detectFeed(input = {}) {
  const url = normalizeUrl(input.url || "");
  const html = String(input.html || "");
  const contentType = String(input.contentType || "").toLowerCase();
  const parsed = safeParseUrl(url);
  const hostname = parsed?.hostname || "";
  const pathname = normalizePath(parsed?.pathname || "");
  const lowerUrl = url.toLowerCase();
  const lowerHtmlStart = html.slice(0, 5000).toLowerCase();

  if (!url && !html.trim()) {
    return result({
      ok: false,
      url,
      hostname,
      sourceType: "unknown",
      kind: "unknown",
      confidence: 0,
      reason: "Mangler URL og innhold."
    });
  }

  const extension = getUrlExtension(pathname);

  if (DOCUMENT_EXTENSIONS.includes(extension) || contentType.includes("application/pdf")) {
    return result({
      ok: true,
      url,
      hostname,
      sourceType: extension === "pdf" || contentType.includes("pdf") ? "pdf" : "document",
      kind: "document",
      shouldExtractLinks: false,
      shouldCleanDirect: false,
      shouldFetchAsDocument: true,
      confidence: 10,
      reason: "URL eller content-type peker på dokument/PDF."
    });
  }

  if (isRssFeed({ html, contentType, lowerHtmlStart })) {
    return result({
      ok: true,
      url,
      hostname,
      sourceType: "rss_feed",
      kind: "feed",
      shouldExtractLinks: true,
      shouldCleanDirect: false,
      candidateFeedUrls: [],
      confidence: 10,
      reason: "Innholdet ser ut som RSS-feed."
    });
  }

  if (isAtomFeed({ html, contentType, lowerHtmlStart })) {
    return result({
      ok: true,
      url,
      hostname,
      sourceType: "atom_feed",
      kind: "feed",
      shouldExtractLinks: true,
      shouldCleanDirect: false,
      candidateFeedUrls: [],
      confidence: 10,
      reason: "Innholdet ser ut som Atom-feed."
    });
  }

  const candidateFeedUrls = findFeedLinks({ html, url });

  const siteSpecific = detectSiteSpecific({ url, hostname, pathname, html, lowerUrl, candidateFeedUrls });
  if (siteSpecific) return result(siteSpecific);

  if (looksLikeArticle({ html, pathname, hostname })) {
    return result({
      ok: true,
      url,
      hostname,
      sourceType: "article",
      kind: "article",
      shouldExtractLinks: false,
      shouldCleanDirect: true,
      candidateFeedUrls,
      confidence: 8,
      reason: "Siden ser ut som en enkeltartikkel."
    });
  }

  if (looksLikeDocumentList({ html, pathname, lowerUrl })) {
    return result({
      ok: true,
      url,
      hostname,
      sourceType: "document_list",
      kind: "list",
      shouldExtractLinks: true,
      shouldCleanDirect: false,
      candidateFeedUrls,
      confidence: 7,
      reason: "Siden ser ut som en liste med dokumenter, høringer eller vedlegg."
    });
  }

  if (looksLikeFrontPageOrListing({ html, pathname, candidateFeedUrls })) {
    return result({
      ok: true,
      url,
      hostname,
      sourceType: candidateFeedUrls.length ? "frontpage_with_feed" : "listing_page",
      kind: candidateFeedUrls.length ? "frontpage" : "list",
      shouldExtractLinks: true,
      shouldCleanDirect: false,
      candidateFeedUrls,
      confidence: candidateFeedUrls.length ? 8 : 6,
      reason: candidateFeedUrls.length
        ? "Siden ser ut som forside/listeside og har feed-lenke."
        : "Siden ser ut som forside eller listeside."
    });
  }

  return result({
    ok: true,
    url,
    hostname,
    sourceType: "unknown",
    kind: "unknown",
    shouldExtractLinks: false,
    shouldCleanDirect: true,
    candidateFeedUrls,
    confidence: 3,
    reason: "Ukjent sidetype. Prøver direkte rensing som fallback."
  });
}

function detectSiteSpecific({ url, hostname, pathname, html, lowerUrl, candidateFeedUrls }) {
  const host = hostname.toLowerCase();

  if (host.includes("nrk.no")) {
    if (isNrkArticle(pathname, html)) {
      return {
        ok: true,
        url,
        hostname,
        sourceType: "nrk_article",
        kind: "article",
        shouldExtractLinks: false,
        shouldCleanDirect: true,
        candidateFeedUrls,
        confidence: 9,
        reason: "NRK-side ser ut som enkeltartikkel."
      };
    }

    return {
      ok: true,
      url,
      hostname,
      sourceType: "nrk_frontpage",
      kind: "frontpage",
      shouldExtractLinks: true,
      shouldCleanDirect: false,
      candidateFeedUrls: candidateFeedUrls.length ? candidateFeedUrls : guessNrkFeedUrls(url),
      confidence: 9,
      reason: "NRK skal behandles som forside/feed, ikke som vanlig artikkel."
    };
  }

  if (host.includes("halden.kommune.no")) {
    if (lowerUrl.includes("kunngjoringer") || lowerUrl.includes("horing") || lowerUrl.includes("h%C3%B8ring") || lowerUrl.includes("hoering")) {
      return {
        ok: true,
        url,
        hostname,
        sourceType: "municipality_hearing_page",
        kind: "list",
        shouldExtractLinks: true,
        shouldCleanDirect: true,
        candidateFeedUrls,
        confidence: 8,
        reason: "Kommunal kunngjøring/høring. Både rens tekst og finn dokumentlenker."
      };
    }

    if (looksLikeArticle({ html, pathname, hostname })) {
      return {
        ok: true,
        url,
        hostname,
        sourceType: "municipality_article",
        kind: "article",
        shouldExtractLinks: false,
        shouldCleanDirect: true,
        candidateFeedUrls,
        confidence: 8,
        reason: "Kommunal enkeltside/artikkel."
      };
    }

    return {
      ok: true,
      url,
      hostname,
      sourceType: "municipality_listing_page",
      kind: "list",
      shouldExtractLinks: true,
      shouldCleanDirect: false,
      candidateFeedUrls,
      confidence: 7,
      reason: "Kommunal listeside. Finn relevante saker/dokumenter før AI."
    };
  }

  if (host.includes("politiet.no")) {
    return {
      ok: true,
      url,
      hostname,
      sourceType: "police_log_page",
      kind: "list",
      shouldExtractLinks: true,
      shouldCleanDirect: false,
      candidateFeedUrls,
      confidence: 8,
      reason: "Politiloggen bør behandles som hendelsesliste, ikke vanlig artikkel."
    };
  }

  if (host.includes("vegvesen.no")) {
    return {
      ok: true,
      url,
      hostname,
      sourceType: "traffic_page",
      kind: "list",
      shouldExtractLinks: true,
      shouldCleanDirect: false,
      candidateFeedUrls,
      confidence: 7,
      reason: "Trafikkside. Behandles som varsel/liste."
    };
  }

  return null;
}

function isRssFeed({ html, contentType, lowerHtmlStart }) {
  if (FEED_CONTENT_TYPES.some(type => contentType.includes(type)) && /<rss[\s>]/i.test(html)) return true;
  if (contentType.includes("rss")) return true;
  if (/^\s*<\?xml/i.test(html) && lowerHtmlStart.includes("<rss")) return true;
  if (lowerHtmlStart.includes("<rss") && lowerHtmlStart.includes("<channel")) return true;
  return false;
}

function isAtomFeed({ html, contentType, lowerHtmlStart }) {
  if (contentType.includes("atom")) return true;
  if (/^\s*<\?xml/i.test(html) && /<feed[\s>]/i.test(html)) return true;
  if (lowerHtmlStart.includes("<feed") && lowerHtmlStart.includes("<entry")) return true;
  return false;
}

function findFeedLinks({ html = "", url = "" }) {
  const out = [];

  if (!html.trim()) return out;

  if (cheerio) {
    try {
      const $ = cheerio.load(html);
      $('link[type="application/rss+xml"], link[type="application/atom+xml"], link[type="application/xml"], link[rel="alternate"]').each((_, el) => {
        const type = String($(el).attr("type") || "").toLowerCase();
        const href = $(el).attr("href");
        if (!href) return;
        if (type.includes("rss") || type.includes("atom") || /rss|feed|atom/i.test(href)) {
          out.push(resolveUrl(href, url));
        }
      });
    } catch (err) {
      // fallback under
    }
  }

  const re = /<link[^>]+(?:type=["']application\/(?:rss\+xml|atom\+xml|xml)["'][^>]*href=["']([^"']+)["']|href=["']([^"']+)["'][^>]*type=["']application\/(?:rss\+xml|atom\+xml|xml)["'])[^>]*>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    out.push(resolveUrl(match[1] || match[2], url));
  }

  const guessed = guessCommonFeedUrls(url);
  return unique([...out, ...guessed.filter(Boolean)]).slice(0, 8);
}

function guessCommonFeedUrls(url = "") {
  const parsed = safeParseUrl(url);
  if (!parsed) return [];

  const base = `${parsed.protocol}//${parsed.host}`;
  const path = normalizePath(parsed.pathname);
  const guesses = [];

  if (path && path !== "/") {
    guesses.push(`${base}${path.replace(/\/$/, "")}/rss`);
    guesses.push(`${base}${path.replace(/\/$/, "")}.rss`);
  }

  guesses.push(`${base}/rss`);
  guesses.push(`${base}/feed`);
  guesses.push(`${base}/rss.xml`);

  return guesses;
}

function guessNrkFeedUrls(url = "") {
  const parsed = safeParseUrl(url);
  const base = parsed ? `${parsed.protocol}//${parsed.host}` : "https://www.nrk.no";
  return unique([
    `${base}/ostfold/toppsaker.rss`,
    `${base}/ostfold/siste.rss`,
    `${base}/nyheter/siste.rss`,
    `${base}/toppsaker.rss`,
    ...guessCommonFeedUrls(url)
  ]).slice(0, 8);
}

function isNrkArticle(pathname = "", html = "") {
  const path = normalizePath(pathname);
  if (/\/[^/]+\/1\.\d+/i.test(path)) return true;
  if (/data-article-id|articleBody|"@type"\s*:\s*"NewsArticle"/i.test(html)) return true;
  if (/<article[\s>]/i.test(html) && /<h1[\s>]/i.test(html)) return true;
  return false;
}

function looksLikeArticle({ html = "", pathname = "", hostname = "" }) {
  const path = normalizePath(pathname);
  const lower = html.toLowerCase();

  if (/<article[\s>]/i.test(html) && /<h1[\s>]/i.test(html)) return true;
  if (/"@type"\s*:\s*"NewsArticle"/i.test(html)) return true;
  if (/property=["']og:type["'][^>]+content=["']article["']/i.test(html)) return true;
  if (/name=["']article:published_time["']|property=["']article:published_time["']/i.test(html)) return true;

  const slashCount = path.split("/").filter(Boolean).length;
  if (slashCount >= 2 && /\d{4}|\d{5}|\.\d+|-[a-zæøå0-9]{4,}/i.test(path) && lower.includes("<h1")) return true;

  return false;
}

function looksLikeDocumentList({ html = "", pathname = "", lowerUrl = "" }) {
  const lower = `${lowerUrl} ${pathname} ${html.slice(0, 40000)}`.toLowerCase();
  const fileHits = (lower.match(/\.(pdf|docx|xlsx|pptx)\b/g) || []).length;
  const docWords = (lower.match(/\b(vedlegg|dokument|saksframlegg|referat|høring|horing|offentlig ettersyn|kunngjøring|kunngjoring|regulering|planforslag)\b/g) || []).length;

  if (fileHits >= 2) return true;
  if (docWords >= 4 && /<a\b/i.test(html)) return true;
  return false;
}

function looksLikeFrontPageOrListing({ html = "", pathname = "", candidateFeedUrls = [] }) {
  const path = normalizePath(pathname);
  const lower = html.toLowerCase();
  const anchorCount = (html.match(/<a\b/gi) || []).length;
  const h2Count = (html.match(/<h2\b/gi) || []).length;
  const articleCount = (html.match(/<article\b/gi) || []).length;

  if (candidateFeedUrls.length) return true;
  if (FRONT_PAGE_HINTS.includes(path)) return true;
  if (anchorCount >= 20 && (h2Count >= 4 || articleCount >= 4)) return true;
  if (lower.includes("siste nytt") || lower.includes("nyheter") || lower.includes("kunngjøringer") || lower.includes("høringer")) return true;

  return false;
}

function result(data) {
  return {
    ok: data.ok !== false,
    url: data.url || "",
    hostname: data.hostname || "",
    sourceType: data.sourceType || "unknown",
    kind: data.kind || "unknown",
    shouldExtractLinks: data.shouldExtractLinks === true,
    shouldCleanDirect: data.shouldCleanDirect === true,
    shouldFetchAsDocument: data.shouldFetchAsDocument === true,
    candidateFeedUrls: Array.isArray(data.candidateFeedUrls) ? unique(data.candidateFeedUrls).filter(Boolean) : [],
    confidence: clamp(Number(data.confidence || 0), 0, 10),
    reason: data.reason || "",
    debug: data.debug || {}
  };
}

function normalizeUrl(url = "") {
  return String(url || "").trim();
}

function safeParseUrl(url = "") {
  try {
    if (!url) return null;
    return new URL(url);
  } catch (err) {
    return null;
  }
}

function normalizePath(pathname = "") {
  const path = String(pathname || "/").trim() || "/";
  return path.length > 1 ? path.replace(/\/$/, "") : "/";
}

function getUrlExtension(pathname = "") {
  const clean = String(pathname).split("?")[0].split("#")[0];
  const match = clean.match(/\.([a-z0-9]{2,5})$/i);
  return match ? match[1].toLowerCase() : "";
}

function resolveUrl(href = "", base = "") {
  try {
    return new URL(href, base || undefined).toString();
  } catch (err) {
    return href || "";
  }
}

function unique(list = []) {
  return Array.from(new Set(list.map(v => String(v || "").trim()).filter(Boolean)));
}

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

module.exports = {
  detectFeed,
  detectSourceType: detectFeed,
  findFeedLinks,
  guessCommonFeedUrls,
  guessNrkFeedUrls
};
