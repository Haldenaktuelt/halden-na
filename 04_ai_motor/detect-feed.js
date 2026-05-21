function detectFeed(input = {}) {
  const url = String(input.url || "").toLowerCase();
  const html = String(input.html || "");
  const contentType = String(input.contentType || "").toLowerCase();

  if (contentType.includes("rss") || contentType.includes("xml") || /<rss|<feed|<channel|<item/i.test(html)) {
    return { type: "rss", confidence: 9, reason: "RSS/XML-feed" };
  }

  if (url.endsWith(".pdf")) return { type: "pdf", confidence: 9, reason: "PDF-dokument" };

  if (url.includes("nrk.no") && !/\/\d+\.\d+/.test(url)) {
    return { type: "frontpage", confidence: 8, reason: "NRK-forside eller seksjonsside" };
  }

  if (/kunngjor|horing|høring|offentlig-ettersyn|plan|aktuelt|nyheter/.test(url)) {
    return { type: "list", confidence: 7, reason: "Liste-/kildeside" };
  }

  const articleSignals = [
    /<article/i,
    /property=["']og:type["'] content=["']article/i,
    /<meta[^>]+article/i
  ];

  if (articleSignals.some(rx => rx.test(html))) {
    return { type: "article", confidence: 8, reason: "Artikkelstruktur funnet" };
  }

  const linkCount = (html.match(/<a\s/gi) || []).length;
  if (linkCount > 20) return { type: "list", confidence: 5, reason: "Mange lenker på siden" };

  return { type: "article", confidence: 4, reason: "Fallback: behandles som enkel artikkel" };
}

module.exports = { detectFeed };
