const { detectFeed } = require("./detect-feed.js");
const { extractArticleLinks } = require("./extract-article-links.js");
const { cleanContent } = require("./clean-content.js");
const { analyzeArticle } = require("./ai-analyze.js");
const { writeDraft } = require("./ai-write-draft.js");

const DEFAULT_MAX_ARTICLES = 5;
const DEFAULT_MIN_SCORE = 6;

async function runPipelineForSource(source = {}) {
  const url = source.link || source.url || "";
  const sourceName = source.name || source.sourceName || "Kilde";
  const instruction = source.instruction || "";
  const maxArticles = Number(source.maxArticles || DEFAULT_MAX_ARTICLES);
  const minScore = Number(source.minScore || DEFAULT_MIN_SCORE);

  if (!url) return { ok: false, error: "Mangler URL.", results: [] };

  const firstPage = await fetchSourcePage(url);
  const feedInfo = detectFeed({
    url,
    html: firstPage.html,
    contentType: firstPage.contentType,
    sourceName,
    instruction
  });

  const candidates = await buildCandidates({
    url,
    html: firstPage.html,
    contentType: firstPage.contentType,
    feedInfo,
    maxArticles
  });

  const results = [];

  for (const candidate of candidates) {
    try {
      const page = candidate.html ? candidate : await fetchSourcePage(candidate.url);

      const cleaned = cleanContent({
        url: page.url || candidate.url,
        html: page.html || "",
        sourceName,
        instruction
      });

      const hashText = `${cleaned.title}\n${cleaned.ingress}\n${cleaned.content}`.slice(0, 3000);
      const isMunicipality = isMunicipalitySource({ url: page.url || candidate.url, sourceName, instruction, text: hashText });
      const minLength = isMunicipality ? 90 : 160;
      const minQuality = isMunicipality ? 3 : 4;

      if (!cleaned.content || cleaned.content.length < minLength || cleaned.quality < minQuality) {
        results.push({
          ok: true,
          skipped: true,
          status: "for_lite_innhold",
          reason: "For lite rent innhold etter rensing.",
          url: page.url || candidate.url,
          hashText,
          cleaned
        });
        continue;
      }

      const analysis = await analyzeArticle({
        title: cleaned.title,
        ingress: cleaned.ingress,
        content: cleaned.content,
        url: page.url || candidate.url,
        sourceName,
        instruction
      });

      if (!analysis.worthy || Number(analysis.score || 0) < minScore) {
        results.push({
          ok: true,
          skipped: true,
          status: "ikke_god_nok",
          reason: analysis.reason || "Lav nyhetsverdi.",
          score: Number(analysis.score || 0),
          kategori: analysis.kategori || "",
          url: page.url || candidate.url,
          hashText,
          cleaned,
          analysis
        });
        continue;
      }

      const draft = await writeDraft({
        title: cleaned.title,
        ingress: cleaned.ingress,
        content: cleaned.content,
        kategori: analysis.kategori || "Lokalt",
        sourceName,
        sourceUrl: page.url || candidate.url,
        analysis
      });

      results.push({
        ok: true,
        skipped: false,
        status: "kladd_klar",
        score: Number(analysis.score || 0),
        kategori: draft.kategori || analysis.kategori || "Lokalt",
        url: page.url || candidate.url,
        hashText,
        cleaned,
        analysis,
        draft: {
          kategori: draft.kategori || analysis.kategori || "Lokalt",
          tittel: draft.tittel || analysis.tema || cleaned.title || "Ny lokal sak",
          ingress: draft.ingress || analysis.hovedpoeng || cleaned.ingress || "",
          tekst: draft.tekst || ""
        }
      });
    } catch (error) {
      results.push({
        ok: false,
        skipped: true,
        status: "feil",
        url: candidate.url,
        error: error.message
      });
    }
  }

  return {
    ok: true,
    sourceName,
    url,
    feedInfo,
    checked: candidates.length,
    draftsReady: results.filter(r => r.ok && !r.skipped && r.draft).length,
    results
  };
}

async function buildCandidates({ url, html, contentType, feedInfo, maxArticles }) {
  if (feedInfo.type === "rss") {
    const rssLinks = extractRssLinks(html, url).slice(0, maxArticles);
    return rssLinks.map(item => ({ url: item.url, title: item.title, html: "" }));
  }

  if (feedInfo.type === "frontpage" || feedInfo.type === "list") {
    const links = extractArticleLinks({ url, html, maxLinks: maxArticles });
    if (links.length) return links.map(link => ({ url: link.url, title: link.title, html: "" }));

    // V12.3: kommune-/høringssider kan være selve saken selv om siden ser ut som liste.
    if (isMunicipalitySource({ url, text: html })) {
      return [{ url, html, contentType }];
    }
  }

  return [{ url, html, contentType }];
}

function isMunicipalitySource(input = {}) {
  const hay = `${input.url || ""} ${input.sourceName || ""} ${input.instruction || ""} ${input.text || ""}`.toLowerCase();
  return /(kommune|kunngjor|kunngjør|horing|høring|offentlig-ettersyn|offentlig ettersyn|detaljregulering|reguleringsplan|planforslag)/.test(hay);
}

function extractRssLinks(xml = "", baseUrl = "") {
  const items = [];
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  const matches = xml.match(itemRegex) || [];

  for (const item of matches) {
    const link = pickXml(item, "link");
    const title = pickXml(item, "title");
    try {
      if (link) items.push({ url: new URL(link, baseUrl).toString(), title });
    } catch {}
  }

  return items;
}

function pickXml(xml = "", tag = "") {
  const rx = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(rx);
  return match ? String(match[1]).replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
}

async function fetchSourcePage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "HaldenNaaKildevakt/3.0 kontakt:redaksjon@halden-naa.no",
      "Accept": "text/html,application/xhtml+xml,application/xml,text/plain"
    }
  });

  if (!res.ok) throw new Error(`Kilden svarte ${res.status}`);

  return {
    url,
    contentType: res.headers.get("content-type") || "",
    html: await res.text()
  };
}

module.exports = { runPipelineForSource, runPipeline: runPipelineForSource };
