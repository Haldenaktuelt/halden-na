const { calculateEditorialScore } = require("./editorial-score.js");
const { improveDraft } = require("./editorial-rewrite.js");

function processEditorial(input = {}) {
  const score = calculateEditorialScore(input);

  if (!score.isInteresting) {
    return {
      skipped: true,
      score: score.score,
      reason: "Lav redaksjonell verdi"
    };
  }

  return {
    skipped: false,
    score: score.score,
    reasons: score.reasons,
    result: improveDraft(input)
  };
}

module.exports = { processEditorial };
