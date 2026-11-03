const DEEPL_URL = "https://api-free.deepl.com/v2/translate";
const MAX_TEXT_BYTES = 120000;

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ message: "Only POST is supported." });
  }

  const origin = request.headers.origin;
  const host = request.headers.host;
  if (origin) {
    try {
      if (!host || new URL(origin).host !== host) {
        return response.status(403).json({ message: "Cross-origin requests are not allowed." });
      }
    } catch (error) {
      return response.status(403).json({ message: "Invalid request origin." });
    }
  }

  const rawApiKey = request.headers["deepl-auth-key"];
  const apiKey = typeof rawApiKey === "string" ? rawApiKey.trim() : "";
  if (!apiKey || apiKey.length < 20 || /\s/.test(apiKey)) {
    return response.status(401).json({ message: "DeepL Authentication Key is missing or invalid." });
  }

  const payload = request.body;
  const supportedLanguagePairs = new Set(["VI:EN", "EN:VI"]);
  if (
    !payload ||
    typeof payload !== "object" ||
    !supportedLanguagePairs.has(`${payload.source_lang}:${payload.target_lang}`) ||
    !Array.isArray(payload.text) ||
    payload.text.length !== 1 ||
    typeof payload.text[0] !== "string"
  ) {
    return response.status(400).json({ message: "Expected one text with source_lang/target_lang VI-EN or EN-VI." });
  }

  const text = payload.text[0];
  if (!text.trim()) {
    return response.status(400).json({ message: "Text must not be empty." });
  }
  if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES) {
    return response.status(413).json({ message: "Text is too large." });
  }

  try {
    const deeplResponse = await fetch(DEEPL_URL, {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000)
    });
    response.setHeader("Content-Type", deeplResponse.headers.get("content-type") || "application/json");
    return response.status(deeplResponse.status).send(await deeplResponse.text());
  } catch (error) {
    return response.status(502).json({ message: "Could not reach DeepL. Check the internet connection." });
  }
};
