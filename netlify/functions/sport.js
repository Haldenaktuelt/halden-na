const { CORS_HEADERS, jsonResponse } = require("./_utils");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  return jsonResponse(200, {
    ok: true,
    updatedAt: new Date().toISOString(),
    startDate: "2026-06-11T20:00:00+02:00",
    items: [
      { text: "Halden NÅ følger VM 2026" },
      { text: "Åpningskamp: 11. juni" },
      { text: "48 lag · 104 kamper" }
    ]
  }, {
    "Cache-Control": "public, max-age=600, s-maxage=900"
  });
};
