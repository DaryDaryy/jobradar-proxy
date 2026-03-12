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
  if (data.error) throw new Error("Google Search error: " + data.error.message);
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
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { system, messages } = req.body;
    const userMsg = messages?.[0]?.content || "";

    const isCoverLetter = userMsg.includes("cover letter") || userMsg.includes("Write a");
    const isJobSearch = userMsg.includes("Generate exactly 8") || userMsg.includes("remote") || userMsg.includes("job");

    if (isCoverLetter) {
      const text = await gemini(userMsg);
      return res.status(200).json({ content: [{ type: "text", text }] });
    }

    if (isJobSearch) {
      const isProductManager = userMsg.includes("product_manager") || (userMsg.includes("Product Manager") && !userMsg.includes("Project Manager"));
      const roleQuery = isProductManager ? "Product Manager" : "Project Manager";
      const roleType = isProductManager ? "product_manager" : "project_manager";

      // Real Google search
      let allResults = [];
      const queries = [
        `"${roleQuery}" remote job hiring 2025`,
        `"${roleQuery}" remote international company vacancy`,
      ];

      for (const q of queries) {
        try {
          const results = await googleSearch(q);
          allResults = allResults.concat(results);
        } catch (e) {
          console.error("Search query failed:", q, e.message);
        }
      }

      // Deduplicate
      const seen = new Set();
      allResults = allResults.filter(r => {
        if (seen.has(r.link)) return false;
        seen.add(r.link);
        return true;
      });

      const searchContext = allResults.slice(0, 15).map((r, i) =>
        `[${i+1}] ${r.title}\nURL: ${r.link}\nSnippet: ${r.snippet}`
      ).join("\n\n");

      const prompt = `You are a job search assistant helping find remote ${roleQuery} positions.

Candidate: Daria Kalinina, Senior ${roleQuery}, 4+ years PM / 9+ years tech, based in Yerevan Armenia, open to remote international roles, English B2/C1. Experience: AI SaaS founder (6000 users), OZON.ru PM, systeme.io PM (500k users, English team), Zvuk/Sber Lead PjM (10 engineers). Skills: Figma, Jira, SQL, Python, Tableau, Amplitude, Scrum.

Real search results found:
${searchContext || "No search results available"}

Based on the search results above AND your knowledge of remote-friendly international tech companies, create a list of 8 relevant ${roleQuery} job openings. Use real URLs from search results where available, otherwise use company career page URLs.

Return ONLY a valid JSON array (absolutely no markdown, no backticks, no text before or after):
[{"id":"1","company":"CompanyName","role":"${roleQuery} Title","type":"${roleType}","location":"Remote (Region)","description":"2 sentence description of the role and company.","email":"careers@company.com","url":"https://company.com/careers","matchScore":85,"matchReason":"Specific reason why this matches Daria"}]

Requirements: 8 unique companies, matchScore 70-95, realistic descriptions, type="${roleType}" for all.`;

      const text = await gemini(prompt);
      console.log("Response preview:", text.slice(0, 300));
      return res.status(200).json({ content: [{ type: "text", text }] });
    }

    // Fallback
    const fullPrompt = system ? `${system}\n\n${userMsg}` : userMsg;
    const text = await gemini(fullPrompt);
    return res.status(200).json({ content: [{ type: "text", text }] });

  } catch (error) {
    console.error("Handler error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
