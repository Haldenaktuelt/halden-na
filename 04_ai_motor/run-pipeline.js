const { detectFeed } = require("./detect-feed.js");
const { extractArticleLinks } = require("./extract-article-links.js");
const { extractDocumentLinks } = require("./extract-document-links.js");
const { fetchDocumentText } = require("./fetch-document-text.js");
const { cleanContent } = require("./clean-content.js");
const { analyzeArticle } = require("./ai-analyze.js");
const { writeDraft } = require("./ai-write-draft.js");

const DEFAULT_MAX_ARTICLES = 5;
const DEFAULT_MAX_DOCUMENTS = 5;
const DEFAULT_MIN_SCORE = 6;

async function runPipelineForSource(source = {}) {
  const url = source.link || source.url || "";
  const sourceName = source.name || source.sourceName || "Kilde";
  const instruction = source.instruction || "";
  const maxArticles = Number(source.maxArticles || DEFAULT_MAX_ARTICLES);
  const maxDocuments = Number(source.maxDocuments || DEFAULT_MAX_DOCUMENTS);
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
    maxArticles,
    maxDocuments,
    sourceName,
    instruction
  });

  const results = [];

  for (const candidate of candidates) {
    try {
      if (candidate.kind === "document") {
        const documentText = await fetchDocumentText({
          url: candidate.url,
          title: candidate.title,
          type: candidate.type
        });

        if (!documentText.ok) {
          results.push({
            ok: true,
            skipped: true,
            status: "document_read_failed",
            reason: documentText.reason || documentText.error || "Dokument kunne ikke leses.",
            url: candidate.url,
            document: candidate,
            hashText: `${candidate.url}\n${candidate.title || ""}`
          });
          continue;
        }

        const cleaned = {
          url: candidate.url,
          sourceName,
          title: candidate.title || documentText.title || "Kommunalt dokument",
          ingress: "",
          content: documentText.content || documentText.text || "",
          text: documentText.content || documentText.text || "",
          quality: documentText.content?.length > 800 ? 8 : 6,
          document: documentText
        };

        const result = await analyzeAndWrite({
          cleaned,
          url: candidate.url,
          sourceName,
          instruction,
          minScore,
          extraHash: `${candidate.url}\n${candidate.title || ""}`
        });

        results.push({
          ...result,
          document: {
            url: candidate.url,
            title: candidate.title || "",
            type: candidate.type || documentText.type || "document",
            pages: documentText.pages || 0
          }
        });

        continue;
      }

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
        const docs = isMunicipality
          ? extractDocumentLinks({
              url: page.url || candidate.url,
              html: page.html || "",
              sourceName,
              instruction,
              maxDocuments
            })
          : [];

        if (docs.length) {
          for (const doc of docs.slice(0, 3)) {
            const documentText = await fetchDocumentText(doc);

            if (!documentText.ok) {
              results.push({
                ok: true,
                skipped: true,
                status: "document_read_failed",
                reason: documentText.reason || documentText.error || "Dokument kunne ikke leses.",
                url: doc.url,
                document: doc,
                hashText: `${doc.url}\n${doc.title || ""}`
              });
              continue;
            }

            const cleanedDoc = {
              url: doc.url,
              sourceName,
              title: doc.title || documentText.title || "Kommunalt dokument",
              ingress: "",
              content: documentText.content || documentText.text || "",
              text: documentText.content || documentText.text || "",
              quality: documentText.content?.length > 800 ? 8 : 6,
              document: documentText
            };

            const result = await analyzeAndWrite({
              cleaned: cleanedDoc,
              url: doc.url,
              sourceName,
              instruction,
              minScore,
              extraHash: `${doc.url}\n${doc.title || ""}`
            });

            results.push({
              ...result,
              document: {
                url: doc.url,
                title: doc.title || "",
                type: doc.type || documentText.type || "document",
                pages: documentText.pages || 0
              }
            });
          }
          continue;
        }

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

      const result = await analyzeAndWrite({
        cleaned,
        url: page.url || candidate.url,
        sourceName,
        instruction,
        minScore
      });

      results.push(result);
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
    documentsRead: results.filter(r => r.document && !r.skipped).length,
    documentReadFailed: results.filter(r => r.status === "document_read_failed").length,
    draftsReady: results.filter(r => r.ok && !r.skipped && r.draft).length,
    results
  };
}

async function analyzeAndWrite({ cleaned, url, sourceName, instruction, minScore, extraHash = "" }) {
  const hashText = `${extraHash}\n${cleaned.title}\n${cleaned.ingress}\n${cleaned.content}`.slice(0, 4000);

  const analysis = await analyzeArticle({
    title: cleaned.title,
    ingress: cleaned.ingress,
    content: cleaned.content,
    url,
    sourceName,
    instruction
  });

  if (!analysis.worthy || Number(analysis.score || 0) < minScore) {
    return {
      ok: true,
      skipped: true,
      status: "ikke_god_nok",
      reason: analysis.reason || "Lav nyhetsverdi.",
      score: Number(analysis.score || 0),
      kategori: analysis.kategori || "",
      url,
      hashText,
      cleaned,
      analysis
    };
  }

  const draft = await writeDraft({
    title: cleaned.title,
    ingress: cleaned.ingress,
    content: cleaned.content,
    kategori: analysis.kategori || "Kommune",
    sourceName,
    sourceUrl: url,
    analysis
  });

  return {
    ok: true,
    skipped: false,
    status: "kladd_klar",
    score: Number(analysis.score || 0),
    kategori: draft.kategori || analysis.kategori || "Kommune",
    url,
    hashText,
    cleaned,
    analysis,
    draft: {
      kategori: draft.kategori || analysis.kategori || "Kommune",
      tittel: draft.tittel || analysis.tema || cleaned.title || "Ny lokal sak",
      ingress: draft.ingress || analysis.hovedpoeng || cleaned.ingress || "",
      tekst: draft.tekst || ""
    }
  };
}

async function buildCandidates({
  url,
  html,
  contentType,
  feedInfo,
  maxArticles,
  maxDocuments,
  sourceName,
  instruction
}) {
  const isMunicipality = isMunicipalitySource({ url, sourceName, instruction, text: html });

  if (isMunicipality) {
    const docs = extractDocumentLinks({
      url,
      html,
      sourceName,
      instruction,
      maxDocuments
    });

    if (docs.length) {
      return docs.map(doc => ({
        kind: "document",
        url: doc.url,
        title: doc.title,
        type: doc.type,
        score: doc.score
      }));
    }
  }

  if (feedInfo.type === "rss") {
    const rssLinks = extractRssLinks(html, url).slice(0, maxArticles);
    return rssLinks.map(item => ({ kind: "article", url: item.url, title: item.title, html: "" }));
  }

  if (feedInfo.type === "frontpage" || feedInfo.type === "list") {
    const links = extractArticleLinks({ url, html, maxLinks: maxArticles });
    if (links.length) return links.map(link => ({ kind: "article", url: link.url, title: link.title, html: "" }));

    if (isMunicipality) {
      return [{ kind: "article", url, html, contentType }];
    }
  }

  return [{ kind: "article", url, html, contentType }];
}

function isMunicipalitySource(input = {}) {
  const hay = `${input.url || ""} ${input.sourceName || ""} ${input.instruction || ""} ${input.text || ""}`.toLowerCase();
  return /(kommune|kunngjor|kunngjør|horing|høring|offentlig-ettersyn|offentlig ettersyn|detaljregulering|reguleringsplan|planforslag|saksframlegg|saksfremlegg|plankart|planbeskrivelse)/.test(hay);
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
      "Accept": "text/html,application/xhtml+xml,application/xml,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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
