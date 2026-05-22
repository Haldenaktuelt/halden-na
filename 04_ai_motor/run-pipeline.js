const { detectFeed } = require("./detect-feed.js");
const { extractArticleLinks } = require("./extract-article-links.js");
const { extractDocumentLinks } = require("./extract-document-links.js");
const { fetchDocumentText } = require("./fetch-document-text.js");
const { cleanContent } = require("./clean-content.js");
const { analyzeArticle } = require("./ai-analyze.js");
const { analyzeDocument } = require("./analyze-document.js");
const { writeDraft } = require("./ai-write-draft.js");
const { processEditorial } = require("./editorial-pipeline.js");

const DEFAULT_MAX_ARTICLES = 5;
const DEFAULT_MAX_DOCUMENTS = 1;
const DEFAULT_MIN_SCORE = 6;
const MAX_AI_CONTENT_CHARS = 6500;

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
  const isMunicipalityRoot = isMunicipalitySource({ url, sourceName, instruction, text: firstPage.html });
  const activeCandidates = candidates.slice(0, isMunicipalityRoot ? 1 : candidates.length);

  for (const candidate of activeCandidates) {
    try {
      if (candidate.kind === "document") {
        results.push(await handleDocumentCandidate({ candidate, sourceName, instruction, minScore }));
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
              maxDocuments: 1
            })
          : [];

        if (docs.length) {
          results.push(await handleDocumentCandidate({
            candidate: { kind: "document", ...docs[0] },
            sourceName,
            instruction,
            minScore
          }));
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

      results.push(await analyzeAndWriteArticle({
        cleaned,
        url: page.url || candidate.url,
        sourceName,
        instruction,
        minScore
      }));
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
    editorialSkipped: results.filter(r => r.status === "editorial_skipped").length,
    draftsReady: results.filter(r => r.ok && !r.skipped && r.draft).length,
    results
  };
}

async function handleDocumentCandidate({ candidate, sourceName, instruction, minScore }) {
  const documentText = await fetchDocumentText({
    url: candidate.url,
    title: candidate.title,
    type: candidate.type
  });

  if (!documentText.ok) {
    return {
      ok: true,
      skipped: true,
      status: "document_read_failed",
      reason: documentText.reason || documentText.error || "Dokument kunne ikke leses.",
      url: candidate.url,
      document: candidate,
      hashText: `${candidate.url}\n${candidate.title || ""}`
    };
  }

  const content = String(documentText.content || documentText.text || "").slice(0, MAX_AI_CONTENT_CHARS);

  const documentAnalysis = await analyzeDocument({
    title: candidate.title || documentText.title || "Kommunalt dokument",
    text: content,
    url: candidate.url,
    sourceName,
    instruction,
    type: candidate.type || documentText.type || "pdf"
  });

  if (!documentAnalysis.isNewsworthy || Number(documentAnalysis.score || 0) < minScore) {
    return {
      ok: true,
      skipped: true,
      status: "document_not_newsworthy",
      reason: documentAnalysis.reason || "Dokumentet ga ikke høy nok nyhetsverdi.",
      score: Number(documentAnalysis.score || 0),
      kategori: documentAnalysis.category || "Kommune",
      url: candidate.url,
      hashText: `${candidate.url}\n${candidate.title || ""}\n${content.slice(0, 2000)}`,
      document: {
        url: candidate.url,
        title: candidate.title || "",
        type: candidate.type || documentText.type || "document",
        pages: documentText.pages || 0
      },
      documentAnalysis
    };
  }

  const draft = await writeDraft({
    title: documentAnalysis.suggestedTitle || candidate.title || "Kommunal sak",
    ingress: documentAnalysis.suggestedIngress || "",
    content,
    kategori: documentAnalysis.category || "Kommune",
    sourceName,
    sourceUrl: candidate.url,
    documentAnalysis
  });

  const editorial = processEditorial({
    title: draft.tittel || documentAnalysis.suggestedTitle || candidate.title || "",
    ingress: draft.ingress || documentAnalysis.suggestedIngress || "",
    content: `${draft.tekst || ""}\n\n${content}`,
    category: draft.kategori || documentAnalysis.category || "Kommune",
    sourceName,
    url: candidate.url
  });

  if (editorial.skipped) {
    return {
      ok: true,
      skipped: true,
      status: "editorial_skipped",
      reason: editorial.reason || "Lav redaksjonell verdi.",
      score: editorial.score || 0,
      kategori: documentAnalysis.category || "Kommune",
      url: candidate.url,
      hashText: `${candidate.url}\n${documentAnalysis.topic}\n${documentAnalysis.location}\n${content.slice(0, 2000)}`,
      documentAnalysis,
      document: {
        url: candidate.url,
        title: candidate.title || "",
        type: candidate.type || documentText.type || "document",
        pages: documentText.pages || 0
      }
    };
  }

  const finalDraft = {
    kategori: draft.kategori || documentAnalysis.category || "Kommune",
    tittel: editorial.result?.title || draft.tittel || documentAnalysis.suggestedTitle || "Kommunal sak",
    ingress: editorial.result?.ingress || draft.ingress || documentAnalysis.suggestedIngress || "",
    tekst: trimArticleText(draft.tekst || editorial.result?.body || "")
  };

  return {
    ok: true,
    skipped: false,
    status: "kladd_klar",
    score: Number(documentAnalysis.score || 0),
    editorialScore: editorial.score,
    editorialReasons: editorial.reasons || [],
    kategori: finalDraft.kategori,
    url: candidate.url,
    hashText: `${candidate.url}\n${documentAnalysis.topic}\n${documentAnalysis.location}\n${content.slice(0, 2000)}`,
    cleaned: {
      url: candidate.url,
      sourceName,
      title: documentAnalysis.suggestedTitle || candidate.title || "Kommunal sak",
      ingress: documentAnalysis.suggestedIngress || "",
      content,
      text: content,
      quality: content.length > 800 ? 8 : 6,
      document: documentText
    },
    analysis: {
      worthy: documentAnalysis.isNewsworthy,
      score: documentAnalysis.score,
      kategori: documentAnalysis.category || "Kommune",
      tema: finalDraft.tittel || documentAnalysis.topic || "",
      hovedpoeng: finalDraft.ingress || documentAnalysis.importance || "",
      reason: documentAnalysis.reason || ""
    },
    documentAnalysis,
    document: {
      url: candidate.url,
      title: candidate.title || "",
      type: candidate.type || documentText.type || "document",
      pages: documentText.pages || 0
    },
    draft: finalDraft
  };
}

async function analyzeAndWriteArticle({ cleaned, url, sourceName, instruction, minScore, extraHash = "" }) {
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
    kategori: analysis.kategori || "Lokalt",
    sourceName,
    sourceUrl: url,
    analysis
  });

  return {
    ok: true,
    skipped: false,
    status: "kladd_klar",
    score: Number(analysis.score || 0),
    kategori: draft.kategori || analysis.kategori || "Lokalt",
    url,
    hashText,
    cleaned,
    analysis,
    draft: {
      kategori: draft.kategori || analysis.kategori || "Lokalt",
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
      maxDocuments: Math.min(1, maxDocuments)
    });

    if (docs.length) {
      return docs.slice(0, 1).map(doc => ({
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

function trimArticleText(text = "") {
  return String(text || "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isMunicipalitySource(input = {}) {
  const hay = `${input.url || ""} ${input.sourceName || ""} ${input.instruction || ""} ${input.text || ""}`.toLowerCase();
  return /(kommune|kunngjor|kunngjør|horing|høring|offentlig-ettersyn|offentlig ettersyn|detaljregulering|reguleringsplan|planforslag|saksframlegg|saksfremlegg|plankart|planbeskrivelse)/.test(hay);
}

function extractRssLinks(xml = "", baseUrl = "") {
  const items = [];
  const matches = xml.match(/<item[\s\S]*?<\/item>/gi) || [];

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
