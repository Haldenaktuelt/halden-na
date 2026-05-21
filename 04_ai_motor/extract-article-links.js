import * as cheerio from "cheerio";

const BAD_PATH_PARTS = [
  "/sport/resultater",
  "/kontakt",
  "/om/",
  "/personvern",
  "/cookies",
  "/login",
  "/logg-inn",
  "/nyhetsbrev",
  "/tips-oss",
  "/radio/",
  "/tv/",
  "/video/",
  "/direkte/",
  "/sok",
  "/search",
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "linkedin.com",
  "mailto:",
  "tel:"
];

const ARTICLE_HINTS = [
  "/nyheter/",
  "/ostfold/",
  "/osloogviken/",
  "/lokal/",
  "/innenriks/",
  "/norge/",
  "/kultur/",
  "/sport/",
  "/artikkel/",
  "/sak/",
  "/2025/",
  "/2026/"
];

function safeUrl(href, baseUrl) {
  if (!href || typeof href !== "string") return null;

  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  try {
    const url = new URL(trimmed, baseUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeText(value = "") {
  return String(value)
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

function isBadLink(urlString = "") {
  const lower = urlString.toLowerCase();
  return BAD_PATH_PARTS.some(part => lower.includes(part));
}

function sameDomainOrAllowed(urlString, baseUrl) {
  try {
    const url = new URL(urlString);
    const base = new URL(baseUrl);

    if (url.hostname === base.hostname) return true;

    // NRK kan ha varianter, men bør fortsatt ligge på nrk.no
    if (base.hostname.includes("nrk.no") && url.hostname.includes("nrk.no")) return true;

    return false;
  } catch {
    return false;
  }
}

function scoreLink({ url, title, text, sourceUrl }) {
  const lowerUrl = url.toLowerCase();
  const lowerText = `${title} ${text}`.toLowerCase();
  let score = 0;

  if (sameDomainOrAllowed(url, sourceUrl)) score += 4;
  if (ARTICLE_HINTS.some(hint => lowerUrl.includes(hint))) score += 4;
  if (/\/\d{4}\//.test(lowerUrl)) score += 2;
  if (/[-_]\d{6,}/.test(lowerUrl)) score += 2;
  if (title.length >= 20) score += 3;
  if (text.length >= 35) score += 1;
  if (lowerText.includes("halden")) score += 5;
  if (lowerText.includes("østfold") || lowerText.includes("ostfold")) score += 3;
  if (lowerText.includes("sarpsborg") || lowerText.includes("fredrikstad")) score += 1;

  if (lowerText.includes("annonse") || lowerText.includes("reklame")) score -= 5;
  if (lowerText.includes("direkte") || lowerText.includes("live")) score -= 1;
  if (isBadLink(url)) score -= 10;

  return score;
}

function uniqueByUrl(items) {
  const map = new Map();

  items.forEach(item => {
    if (!item?.url) return;
    const existing = map.get(item.url);
    if (!existing || item.score > existing.score) {
      map.set(item.url, item);
    }
  });

  return Array.from(map.values());
}

export function extractArticleLinks(html = "", sourceUrl = "", options = {}) {
  const maxLinks = Number(options.maxLinks || 12);

  if (!html || !sourceUrl) {
    return {
      ok: false,
      type: "article_links",
      sourceUrl,
      count: 0,
      links: [],
      error: "Mangler HTML eller sourceUrl"
    };
  }

  const $ = cheerio.load(html);

  $("script, style, noscript, svg, form, input, button, nav, footer, header").remove();
  $("[class*='cookie'], [id*='cookie'], [class*='consent'], [id*='consent']").remove();
  $("[class*='ad'], [id*='ad'], [class*='advert'], [class*='promo']").remove();

  const found = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const url = safeUrl(href, sourceUrl);
    if (!url) return;
    if (!sameDomainOrAllowed(url, sourceUrl)) return;
    if (isBadLink(url)) return;

    const title = normalizeText(
      $(el).attr("aria-label") ||
      $(el).attr("title") ||
      $(el).find("h1,h2,h3,h4").first().text() ||
      $(el).text()
    );

    const text = normalizeText($(el).text());

    if (title.length < 8 && text.length < 20) return;

    const item = {
      url,
      title: title.slice(0, 180),
      text: text.slice(0, 260),
      score: 0
    };

    item.score = scoreLink({ ...item, sourceUrl });

    if (item.score >= 2) {
      found.push(item);
    }
  });

  const links = uniqueByUrl(found)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxLinks)
    .map((item, index) => ({
      rank: index + 1,
      url: item.url,
      title: item.title,
      score: item.score,
      preview: item.text
    }));

  return {
    ok: true,
    type: "article_links",
    sourceUrl,
    count: links.length,
    links
  };
}

export default extractArticleLinks;
