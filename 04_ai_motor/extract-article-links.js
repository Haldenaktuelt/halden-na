const cheerio = require("cheerio");
const { cleanText } = require("./clean-content.js");

function extractArticleLinks(input = {}) {
  const html = input.html || "";
  const baseUrl = input.url || "";
  const maxLinks = Number(input.maxLinks || 8);
  const $ = cheerio.load(html);
  const links = [];

  $("a[href]").each((_, el) => {
    const href = String($(el).attr("href") || "").trim();
    const title = cleanText($(el).text());
    const url = absoluteUrl(href, baseUrl);

    if (!url || !isArticleLike(url, title)) return;

    links.push({
      url,
      title: title || url,
      score: scoreLink(url, title)
    });
  });

  return dedupeLinks(links)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxLinks);
}

function isArticleLike(url = "", title = "") {
  const lower = `${url} ${title}`.toLowerCase();

  if (!/^https?:\/\//.test(url)) return false;

  const bad = [
    "facebook","twitter","instagram","linkedin","mailto:",
    "/tag/","/emne/","/kategori/","/search","/sok","/login",
    "personvern","cookies","kontakt","om-oss","rss"
  ];

  if (bad.some(x => lower.includes(x))) return false;
  if (title && title.length < 12) return false;

  if (url.includes("nrk.no") && /\/\d+\.\d+/.test(url)) return true;
  if (/nyhet|aktuelt|sak|article|story|kunngjor|horing|høring|offentlig-ettersyn|detaljregulering/.test(lower)) return true;
  if (title.length > 35) return true;

  return false;
}

function scoreLink(url = "", title = "") {
  const lower = `${url} ${title}`.toLowerCase();
  let score = 0;

  if (title.length > 25) score += 3;
  if (title.length > 60) score += 1;
  if (url.includes("nrk.no") && /\/\d+\.\d+/.test(url)) score += 6;
  if (/halden|østfold|ostfold|kommune|høring|horing|regulering|trafikk|politi|brann|arrangement/.test(lower)) score += 4;
  if (/annonse|partner|kontakt|personvern|meny|logg inn/.test(lower)) score -= 8;

  return score;
}

function absoluteUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString().split("#")[0];
  } catch {
    return "";
  }
}

function dedupeLinks(links = []) {
  const seen = new Set();
  return links.filter(link => {
    if (seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

module.exports = { extractArticleLinks };
