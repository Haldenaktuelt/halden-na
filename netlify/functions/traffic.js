const { CORS_HEADERS, jsonResponse } = require("./_utils");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  return jsonResponse(200, {
    ok: true,
    active: false,
    updatedAt: new Date().toISOString(),
    items: []
  }, {
    "Cache-Control": "public, max-age=180, s-maxage=300"
  });
};
