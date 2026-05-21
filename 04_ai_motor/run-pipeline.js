import { detectFeed } from "./detect-feed.js";
import { extractArticleLinks } from "./extract-article-links.js";
import { cleanContent } from "./clean-content.js";
import { analyzeArticle } from "./ai-analyze.js";
import { writeDraft } from "./ai-write-draft.js";

/**
 * V12 Smart AI Pipeline
 *
 * Denne filen er "hjernen" i AI-motoren.
 * Den skal ikke publisere noe direkte.
 * Den skal:
 * 1. forstå kilden
 * 2. finne relevante artikler
 * 3. rense innhold
 * 4. analysere nyhetsverdi
 * 5. skrive kladd bare hvis saken er god nok
 */

const DEFAULT_MAX_ARTICLES = 5;
const DEFAULT_MIN_SCORE = 6;

export async function runPipeline(input = {}) {
  const {
    url = "",
    html = "",
    sourceName = "",
    instruction = "",
    maxArticles = DEFAULT_MAX_ARTICLES,
    minScore = DEFAULT_MIN_SCORE
  } = input;

  const results = [];

  if (!url && !html) {
    return {
      ok: false,
      error: "Mangler URL eller HTML.",
      results
    };
  }

  try {
    const feedInfo = detectFeed({
      url,
      html,
      sourceName,
      instruction
    });

    const candidates = await buildCandidates({
      url,
      html,
      feedInfo,
      maxArticles
    });

    for (const candidate of candidates) {
      const cleaned = cleanContent({
        url: candidate.url || url,
        html: candidate.html || html,
        sourceName,
        instruction
      });

      if (!cleaned || !cleaned.content || cleaned.content.length < 120) {
        results.push({
          ok: false,
          skipped: true,
          reason: "For lite rent innhold etter rensing.",
          url: candidate.url || url
        });
        continue;
      }

      const analysis = await analyzeArticle({
        title: cleaned.title,
        ingress: cleaned.ingress,
        content: cleaned.content,
        url: candidate.url || url,
        sourceName,
        instruction
      });

      if (!analysis?.worthy || Number(analysis.score || 0) < minScore) {
        results.push({
          ok: true,
          skipped: true,
          reason: analysis?.reason || "Ikke høy nok nyhetsverdi.",
          score: analysis?.score || 0,
          kategori: analysis?.kategori || "",
          url: candidate.url || url,
          cleaned
        });
        continue;
      }

      const draft = await writeDraft({
        title: cleaned.title,
        ingress: cleaned.ingress,
        content: cleaned.content,
        kategori: analysis.kategori || "Lokalt",
        source: sourceName || url,
        sourceUrl: candidate.url || url,
        analysis
      });

      results.push({
        ok: draft?.success === true,
        skipped: false,
        url: candidate.url || url,
        feedInfo,
        cleaned,
        analysis,
        draft
      });
    }

    return {
      ok: true,
      sourceName,
      url,
      feedInfo,
      checked: candidates.length,
      draftsReady: results.filter(r => r.ok && !r.skipped).length,
      results
    };
  } catch (error) {
    console.error("RUN PIPELINE ERROR:", error);

    return {
      ok: false,
      error: error.message,
      sourceName,
      url,
      results
    };
  }
}

async function buildCandidates({ url, html, feedInfo, maxArticles }) {
  const type = feedInfo?.type || "article";

  if (type === "frontpage" || type === "feed" || type === "list") {
    const links = extractArticleLinks({
      url,
      html,
      maxLinks: maxArticles
    });

    return links.slice(0, maxArticles).map(link => ({
      url: link.url,
      title: link.title || "",
      html: ""
    }));
  }

  return [
    {
      url,
      title: "",
      html
    }
  ];
}

/**
 * Denne brukes senere av source-watch.js.
 * Foreløpig lager den bare kladd-resultater,
 * men lagrer ikke i Firestore direkte.
 */
export async function runPipelineForSource(source = {}) {
  return await runPipeline({
    url: source.link || source.url || "",
    html: source.html || "",
    sourceName: source.name || source.sourceName || "",
    instruction: source.instruction || "",
    maxArticles: source.maxArticles || DEFAULT_MAX_ARTICLES,
    minScore: source.minScore || DEFAULT_MIN_SCORE
  });
}
