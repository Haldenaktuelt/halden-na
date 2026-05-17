exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { ok: false, error: "Kun POST støttes" });
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const draft = await makeAiDraft(payload);

    return jsonResponse(200, {
      ok: true,
      draft
    });
  } catch (err) {
    console.error("ai-draft error:", err);

    return jsonResponse(200, {
      ok: true,
      fallback: true,
      draft: localFallbackDraft(JSON.parse(event.body || "{}"))
    });
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8"
  };
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(body)
  };
}

async function makeAiDraft(payload) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return localFallbackDraft(payload);
  }

  const raw = [
    payload.tittel,
    payload.ingress,
    payload.tekst,
    payload.rawInput
  ].filter(Boolean).join("\n\n");

  const input = `
Du er redaksjonsassistent for lokalavisen HALDEN NÅ.

Lag et saklig, kort og folkelig utkast på norsk bokmål.
Ikke dikt opp fakta.
Bruk bare informasjonen i råstoffet.
Skriv kort forklart for vanlige folk.
Saken skal alltid kontrolleres av menneske før publisering.

Kategori: ${payload.kategori || "Lokalt"}
Kilde: ${payload.kilde || ""}
URL: ${payload.sourceUrl || ""}

RÅSTOFF:
${raw}
`;

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input,
      text: {
        format: {
          type: "json_schema",
          name: "halden_na_draft",
          strict: true,
          schema: draftSchema()
        }
      }
    })
  });

  if (!res.ok) {
    throw new Error(`OpenAI svarte ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const text = data.output_text || data.output?.[0]?.content?.[0]?.text || "";
  const draft = JSON.parse(text);

  return {
    kategori: draft.kategori || payload.kategori || "Lokalt",
    tittel: draft.tittel || payload.tittel || "Ny lokal sak",
    ingress: draft.ingress || payload.ingress || "",
    tekst: draft.tekst || payload.tekst || "",
    bildeUrl: payload.bildeUrl || "",
    videoUrl: payload.videoUrl || "",
    mediaPlassering: payload.mediaPlassering || "top",
    kilde: payload.kilde || "AI-utkast",
    sourceUrl: payload.sourceUrl || "",
    hovedsak: false
  };
}

function draftSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      kategori: {
        type: "string",
        enum: [
          "Lokalt",
          "Politilogg",
          "Kommune",
          "Arrangement",
          "Trafikk",
          "Sport",
          "Norge & Verden",
          "Kultur",
          "Meninger",
          "Historie",
          "Kort forklart",
          "Tips"
        ]
      },
      tittel: { type: "string" },
      ingress: { type: "string" },
      tekst: { type: "string" }
    },
    required: ["kategori", "tittel", "ingress", "tekst"]
  };
}

function localFallbackDraft(payload) {
  const raw = (payload.rawInput || payload.tekst || payload.ingress || "").replace(/\s+/g, " ").trim();
  const ingress = payload.ingress || (raw ? raw.slice(0, 130) + (raw.length > 130 ? "..." : "") : "Kort forklart sak for Halden NÅ.");

  return {
    kategori: payload.kategori || "Lokalt",
    tittel: payload.tittel || "AI-forslag klart for kontroll",
    ingress,
    tekst: `${ingress}\n\nKort forklart:\n${raw || "Ingen råtekst."}\n\nDette er et utkast og må kontrolleres før publisering.`,
    bildeUrl: payload.bildeUrl || "",
    videoUrl: payload.videoUrl || "",
    mediaPlassering: payload.mediaPlassering || "top",
    kilde: payload.kilde || "Manuelt råstoff",
    sourceUrl: payload.sourceUrl || "",
    hovedsak: false
  };
}
