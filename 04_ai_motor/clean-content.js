const cheerio = require("cheerio");

function cleanContent(input = {}) {
  const html = input.html || "";
  const url = input.url || "";
  const sourceName = input.sourceName || "";
  const instruction = input.instruction || "";

  if (!html || html.length < 20) {
    return { url, sourceName, title: "", ingress: "", content: "", text: "", quality: 0 };
  }

  const $ = cheerio.load(html);
  removeNoise($);

  const title =
    cleanText($("meta[property='og:title']").attr("content")) ||
    cleanText($("h1").first().text()) ||
    cleanText($("title").first().text()) ||
    "";

  const ingress =
    cleanText($("meta[name='description']").attr("content")) ||
    cleanText($("meta[property='og:description']").attr("content")) ||
    findIngress($);

  const articleRoot = findArticleRoot($);
  const paragraphs = [];

  articleRoot.find("h2,h3,p,li").each((_, el) => {
    const text = cleanText($(el).text());
    if (isGoodLine(text)) paragraphs.push(text);
  });

  let content = dedupe(paragraphs).join("\n\n");

  const municipalityText = extractMunicipalityText($);
  if (municipalityText.length > content.length || isMunicipalityContext({ url, sourceName, instruction })) {
    content = municipalityText || content;
  }

  if (content.length < 180) {
    const bodyLines = [];
    $("body").find("h1,h2,h3,h4,p,li,a").each((_, el) => {
      const text = cleanText($(el).text());
      if (isUsefulMunicipalityLine(text) || isGoodLine(text)) bodyLines.push(text);
    });
    content = dedupe(bodyLines).join("\n\n");
  }

  content = trimText(content, 6500);

  return {
    url,
    sourceName,
    title: trimText(title, 160),
    ingress: trimText(ingress, 260),
    content,
    text: content,
    quality: scoreQuality(title, ingress, content, { url, sourceName, instruction })
  };
}

function extractMunicipalityText($) {
  const lines = [];

  $("body").find("h1,h2,h3,h4,p,li,a").each((_, el) => {
    const text = cleanText($(el).text());
    if (isUsefulMunicipalityLine(text)) lines.push(text);
  });

  const deduped = dedupe(lines);
  const important = [];
  const normal = [];

  for (const line of deduped) {
    if (isHighValueMunicipalityLine(line)) important.push(line);
    else normal.push(line);
  }

  return [...important, ...normal].slice(0, 45).join("\n\n");
}

function isMunicipalityContext(context = {}) {
  const hay = `${context.url || ""} ${context.sourceName || ""} ${context.instruction || ""}`.toLowerCase();
  return /(kommune|kunngjor|kunngjør|horing|høring|offentlig-ettersyn|offentlig ettersyn|detaljregulering|reguleringsplan|planforslag)/.test(hay);
}

function isUsefulMunicipalityLine(text = "") {
  const t = cleanText(text);
  if (t.length < 18) return false;
  if (t.length > 650) return false;

  const lower = t.toLowerCase();

  const bad = [
    "hopp til innhold","hopp til meny","logg inn","kontakt oss",
    "personvern","cookie","informasjonskapsler","til toppen",
    "facebook","instagram","linkedin","youtube","del siden",
    "åpningstider","sentralbord","organisasjonsnummer"
  ];

  if (bad.some(word => lower.includes(word))) return false;

  const goodWords = [
    "høring","horing","offentlig ettersyn","kunngjøring","kunngjoring",
    "detaljregulering","reguleringsplan","planforslag","byggesak",
    "frist","innspill","merknad","uttalelse","varsles","varsel om oppstart",
    "forslag til","kommunestyret","formannskapet","planutvalg",
    "dyrendal","halden","tistedal","idd","berg","svinesund"
  ];

  if (goodWords.some(word => lower.includes(word))) return true;
  if (/^[A-ZÆØÅ0-9].{20,160}$/.test(t) && /(plan|høring|regulering|kunngjør|forslag|varsel)/i.test(t)) return true;

  return false;
}

function isHighValueMunicipalityLine(text = "") {
  const lower = cleanText(text).toLowerCase();
  return [
    "høring","horing","offentlig ettersyn","detaljregulering",
    "reguleringsplan","planforslag","frist","innspill",
    "merknad","varsel om oppstart","kunngjøring","kunngjoring"
  ].some(word => lower.includes(word));
}

function removeNoise($) {
  const selectors = [
    "script","style","noscript","svg","canvas","iframe",
    "nav","header","footer","aside","form","button",
    "[role='navigation']","[role='banner']","[role='contentinfo']",
    ".cookie",".cookies",".consent",".privacy",".gdpr",
    ".advertisement",".ad",".ads",".banner",".promo",
    ".related",".read-more",".share",".social",".newsletter",
    ".menu",".navbar",".sidebar"
  ];

  selectors.forEach(sel => $(sel).remove());

  $("*").each((_, el) => {
    const cls = String($(el).attr("class") || "").toLowerCase();
    const id = String($(el).attr("id") || "").toLowerCase();
    const combined = `${cls} ${id}`;

    if (/(cookie|consent|advert|annonse|promo|share|related|menu|footer|header|sidebar|nav)/.test(combined)) {
      $(el).remove();
    }
  });
}

function findArticleRoot($) {
  const candidates = [
    $("article").first(),
    $("main article").first(),
    $("main").first(),
    $("[class*='article']").first(),
    $("[class*='content']").first(),
    $("[class*='story']").first(),
    $("body").first()
  ];

  return candidates.find(el => el && el.length && cleanText(el.text()).length > 200) || $("body").first();
}

function findIngress($) {
  const selectors = [
    ".lead",".lede",".ingress","[class*='lead']","[class*='ingress']",
    "article p","main p"
  ];

  for (const sel of selectors) {
    const text = cleanText($(sel).first().text());
    if (text.length >= 50 && text.length <= 320) return text;
  }

  return "";
}

function isGoodLine(text = "") {
  const t = cleanText(text);
  if (t.length < 35) return false;
  if (t.length > 900) return false;

  const lower = t.toLowerCase();
  const bad = [
    "hopp til innhold","hopp til meny","logg inn","opprett konto",
    "personvern","cookie","informasjonskapsler","annonse",
    "kontakt oss","nyhetsbrev","del saken","følg oss",
    "publisert","oppdatert","les også"
  ];

  if (bad.some(word => lower.includes(word))) return false;
  if ((t.match(/\b(pdf|docx|xlsx|pptx)\b/gi) || []).length > 5) return false;

  return true;
}

function scoreQuality(title, ingress, content, context = {}) {
  let score = 0;
  const hay = `${title} ${ingress} ${content} ${context.url || ""} ${context.sourceName || ""} ${context.instruction || ""}`.toLowerCase();

  if (title && title.length > 8) score += 2;
  if (ingress && ingress.length > 45) score += 2;
  if (content.length > 180) score += 2;
  if (content.length > 300) score += 2;
  if (content.length > 900) score += 1;
  if (content.length > 6000) score -= 1;

  if (/(høring|horing|offentlig ettersyn|detaljregulering|planforslag|kunngjøring|kunngjoring)/.test(hay)) score += 2;
  if (/(halden|dyrendal|tistedal|svinesund|idd|berg)/.test(hay)) score += 1;

  return Math.max(0, Math.min(10, score));
}

function dedupe(lines = []) {
  const seen = new Set();
  return lines.filter(line => {
    const key = cleanText(line).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanText(value = "") {
  return String(value)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&aring;/gi, "å")
    .replace(/&oslash;/gi, "ø")
    .replace(/&aelig;/gi, "æ")
    .replace(/\s+/g, " ")
    .trim();
}

function trimText(text = "", max = 1000) {
  const clean = cleanText(text);
  return clean.length > max ? clean.slice(0, max).trim() + "..." : clean;
}

module.exports = { cleanContent, cleanText, trimText };
