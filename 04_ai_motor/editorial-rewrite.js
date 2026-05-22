function improveDraft(input = {}) {
  let title = clean(input.title || "");
  let ingress = clean(input.ingress || "");
  let body = clean(input.content || "");

  if (/pdf|protokoll|saksfremlegg/i.test(title)) {
    title = "Kommunal sak kan få betydning lokalt";
  }

  if (body.toLowerCase().includes("dyrendal")) {
    title = "Kommunal plansak i Dyrendal er ute på høring";
  }

  if (ingress.length < 40) {
    ingress = body.slice(0, 180).trim();
  }

  return {
    title,
    ingress,
    body
  };
}

function clean(text = "") {
  return text
    .replace(/arkivkode.*$/gim, "")
    .replace(/journalnummer.*$/gim, "")
    .replace(/pdf/gi, "")
    .replace(/protokoll/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = { improveDraft };
