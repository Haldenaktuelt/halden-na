import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function writeDraft(articleData) {
  try {
    const {
      title = "",
      ingress = "",
      content = "",
      kategori = "Lokalt",
      source = ""
    } = articleData;

    const prompt = `
Du er journalist i lokalavisen HALDEN NÅ.

Oppgave:
Skriv en kort, folkelig og rolig lokalavis-artikkel.

REGLER:
- IKKE kopier råtekst
- IKKE skriv som AI
- Korte avsnitt
- Lett å lese
- Lokalavis-stil
- Kort forklart
- Ingen clickbait

Kategori:
${kategori}

Kilde:
${source}

Tittel:
${title}

Ingress:
${ingress}

Brødtekst:
${content}
`;

    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content: "Du skriver korte og forståelige lokalavis-saker."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    });

    const article =
      response.choices?.[0]?.message?.content?.trim() ||
      "Kunne ikke generere artikkel.";

    return {
      success: true,
      kategori,
      title,
      article
    };
  } catch (error) {
    console.error("AI WRITE DRAFT ERROR:", error);

    return {
      success: false,
      error: error.message
    };
  }
}
