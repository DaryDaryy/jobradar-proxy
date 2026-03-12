export const config = {
  api: { bodyParser: true },
};

const GOOGLE_KEY = process.env.GOOGLE_SEARCH_KEY;
const GOOGLE_CX = process.env.GOOGLE_SEARCH_CX;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

async function googleSearch(query) {
  const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query)}&num=10`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    console.error("Google error:", JSON.stringify(data.error));
    return [];
  }
  return (data.items || []).map(item => ({
    title: item.title,
    link: item.link,
    snippet: item.snippet,
  }));
}

async function gemini(prompt) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 3000 },
      }),
    }
  );
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  console.log("Gemini returned:", text.slice(0, 200));
  return text;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { system, messages } = req.body;
    const userMsg = typeof messages?.[0]?.content === "string"
      ? messages[0].content
      : messages?.[0]?.content?.[0]?.text || "";

    console.log("Request type detection, userMsg start:", userMsg.slice(0, 100));

    // Cover letter
    if (userMsg.toLowerCase().includes("cover letter") || userMsg.toLowerCase().includes("write a 3-paragraph")) {
      const text = await gemini(userMsg);
      return res.status(200).json({ content: [{ type: "text", text }] });
    }

    // Job search — always treat as job search and read type from system or message
    const isProduct = system?.includes("product_manager") || userMsg.includes("product_manager") ||
      (system?.includes("Product Manager") && !system?.includes("Project Manager"));
    const roleType = isProduct ? "product_manager" : "project_manager";
    const roleLabel = isProduct ? "Product Manager" : "Project Manager";

    console.log("Searching for:", roleLabel);

    // Google search
    let allResults = [];
    try {
      const r1 = await googleSearch(`"${roleLabel}" remote job 2025 2026`);
      const r2 = await googleSearch(`${roleLabel} remote hiring international company`);
      allResults = [...r1, ...r2];
      // deduplicate
      const seen = new Set();
      allResults = allResults.filter(r => { if(seen.has(r.link)) return false; seen.add(r.link); return true; });
      console.log("Google results:", allResults.length);
    } catch(e) {
      console.error("Google search failed:", e.message);
    }

    const searchContext = allResults.slice(0, 15).map((r, i) =>
      `[${i+1}] ${r.title}\nURL: ${r.link}\nDescription: ${r.snippet}`
    ).join("\n\n");

    const prompt = `You are a job search assistant. Find 8 remote ${roleLabel} job openings for this candidate.

CANDIDATE: Daria Kalinina, ${roleLabel}, Yerevan Armenia, open to remote. 4+ years PM, 9+ years tech. AI SaaS founder (6000 users), PM at OZON.ru, PM at systeme.io Ireland (English, 500k users), Lead PjM at Zvuk/Sber. Skills: Figma, Jira, SQL, Python, Tableau, Amplitude, Scrum. English B2/C1.

REAL SEARCH RESULTS:
${searchContext || "No results - use your knowledge of remote companies"}

INSTRUCTIONS: Create a JSON array of 8 ${roleLabel} jobs. Use real companies from search results when possible. Fill gaps with well-known remote-friendly companies (GitLab, Miro, Automattic, Doist, Hotjar, Intercom, Typeform, Linear, Loom, Contentful, Deel, Buffer, Help Scout, Prezly).

RESPOND WITH ONLY THIS JSON ARRAY, NO OTHER TEXT:
[{"id":"1","company":"GitLab","role":"Senior ${roleLabel}","type":"${roleType}","location":"Remote (Worldwide)","description":"Own roadmap for DevOps features. Work with distributed engineering teams.","email":"jobs@gitlab.com","url":"https://about.gitlab.com/jobs/","matchScore":90,"matchReason":"Fully remote company matching Daria's cross-functional delivery experience"}]

RULES: exactly 8 items, all unique companies, type="${roleType}" for ALL, matchScore 70-95, no markdown, no backticks, pure JSON array only.`;

    const text = await gemini(prompt);
    return res.status(200).json({ content: [{ type: "text", text }] });

  } catch (error) {
    console.error("Handler error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
