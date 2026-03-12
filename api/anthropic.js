export const config = {
  api: { bodyParser: true },
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { messages, system } = req.body;

    // Convert messages format for Gemini
    const contents = messages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: typeof m.content === "string" ? m.content : m.content[0]?.text || "" }]
    }));

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: system ? { parts: [{ text: system }] } : undefined,
          contents,
          generationConfig: { maxOutputTokens: 1000 },
        }),
      }
    );

    const data = await response.json();
    
    // Convert Gemini response to Anthropic format
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return res.status(200).json({
      content: [{ type: "text", text }]
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
