function calculateEditorialScore(input = {}) {
  const text = `${input.title || ""} ${input.ingress || ""} ${input.content || ""}`.toLowerCase();
  let score = 0;
  const reasons = [];

  const important = ["høring","offentlig ettersyn","detaljregulering","trafikk","brann","politi","skole","helse"];
  const places = ["halden","dyrendal","tistedal","idd","berg"];

  important.forEach(word => {
    if (text.includes(word)) {
      score += 2;
      reasons.push(`Tema: ${word}`);
    }
  });

  places.forEach(place => {
    if (text.includes(place)) {
      score += 1;
      reasons.push(`Lokalt sted: ${place}`);
    }
  });

  if ((input.content || "").length < 120) score -= 3;
  if ((input.content || "").length > 1000) score += 1;

  if (score < 0) score = 0;
  if (score > 10) score = 10;

  return {
    score,
    reasons,
    isInteresting: score >= 6
  };
}

module.exports = { calculateEditorialScore };
