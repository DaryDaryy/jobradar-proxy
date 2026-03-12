export const config = {
  api: { bodyParser: true },
};

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const ADZUNA_ID = process.env.ADZUNA_APP_ID;
const ADZUNA_KEY = process.env.ADZUNA_APP_KEY;

async function searchAdzuna(query, country) {
  const params = new URLSearchParams({
    app_id: ADZUNA_ID,
    app_key: ADZUNA_KEY,
    results_per_page: 20,
    what: query,
    content_type: "application/json",
  });
  const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.exception) { console.error("Adzuna error:", data.exception); return []; }
  return (data.results || []).map(j => ({
    id: j.id,
    title: j.title,
    company: j.company?.display_name || "Unknown",
    location: j.location?.display_name || "Remote",
    description: j.description?.slice(0, 300) || "",
    url: j.redirect_url || "",
    created: j.created || new Date().toISOString(),
    salary: j.salary_min ? `$${Math.round(j.salary_min/1000)}k-$${Math.round((j.salary_max||j.salary_min)/1000)}k` : null,
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
  console.log("Gemini length:", text.length, "preview:", text.slice(0, 100));
  return text;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { messages } = req.body;
    const userMsg = typeof messages?.[0]?.content === "string"
      ? messages[0].content
      : messages?.[0]?.content?.[0]?.text || "";

    // Cover letter
    if (userMsg.includes("cover letter") || userMsg.includes("Write a 3-paragraph")) {
      const text = await gemini(userMsg);
      return res.status(200).json({ content: [{ type: "text", text }] });
    }

    // Job type
    const isProduct = userMsg.includes("product_manager") ||
      (userMsg.includes("Product Manager") && !userMsg.includes("Project Manager"));
    const roleType = isProduct ? "product_manager" : "project_manager";
    const roleLabel = isProduct ? "Product Manager" : "Project Manager";

    // Already seen companies from frontend
    const seenMatch = userMsg.match(/EXCLUDE_COMPANIES:\[(.*?)\]/);
    const excludedCompanies = seenMatch
      ? seenMatch[1].split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
      : [];

    console.log("Searching:", roleLabel, "| Excluding:", excludedCompanies.length, "companies");

    // Adzuna search
    let allJobs = [];
    try {
      const [gbJobs, usJobs] = await Promise.all([
        searchAdzuna(`${roleLabel} remote`, "gb"),
        searchAdzuna(`${roleLabel} remote`, "us"),
      ]);
      allJobs = [...gbJobs, ...usJobs];

      // Deduplicate by company, exclude already seen
      const seen = new Set(excludedCompanies);
      allJobs = allJobs.filter(j => {
        const key = j.company.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      console.log("Adzuna unique new results:", allJobs.length);
    } catch(e) {
      console.error("Adzuna failed:", e.message);
    }

    const jobsContext = allJobs.length > 0
      ? allJobs.slice(0, 20).map((j, i) =>
          `${i+1}. "${j.title}" at ${j.company} | ${j.location}${j.salary ? " | " + j.salary : ""} | Posted: ${j.created?.slice(0,10) || "recent"}\n   ${j.description}\n   URL: ${j.url}`
        ).join("\n\n")
      : `No Adzuna results. Use remote-friendly companies NOT in this list: [${excludedCompanies.join(", ")}]. Pick from: ${isProduct ? "Miro, Hotjar, Intercom, Typeform, Linear, Loom, Contentful, Prezly, Doist, Buffer, Help Scout, Airtable, Pitch, Coda, Notion" : "GitLab, Automattic, Deel, Remote.com, Toggl, Zapier, Productboard, ClickUp, Asana, monday.com, Brex, Pleo, Personio, Leapsome"}.`;

    const today = new Date().toISOString().slice(0, 10);

    const prompt = `Select the best 8 remote ${roleLabel} jobs for this candidate from the listings below.

CANDIDATE: Daria Kalinina, ${roleLabel}, Yerevan Armenia, open to remote. 4+ yrs PM, 9+ yrs tech. AI SaaS founder (6k users), PM OZON.ru, PM systeme.io Ireland (English, 500k users), Lead PjM Zvuk/Sber (10 engineers, Python/K8s/GitLab). Figma, Jira, SQL, Python, Tableau, Amplitude, Scrum. English B2/C1.

JOB LISTINGS:
${jobsContext}

Respond with ONLY a JSON array. No markdown. No backticks. Start with [ end with ]:
[{"id":"1","company":"Name","role":"Title","type":"${roleType}","location":"Remote (Region)","description":"2 sentences about the role.","email":"careers@company.com","url":"https://...","matchScore":85,"matchReason":"Specific reason for Daria","postedDate":"${today}"}]

RULES:
- Exactly 8 jobs
- All unique companies  
- type="${roleType}" for ALL entries
- matchScore 70-95
- postedDate: use real date from listings when available, otherwise use today "${today}"
- Use real Adzuna URLs when available`;

    const text = await gemini(prompt);
    return res.status(200).json({ content: [{ type: "text", text }] });

  } catch (error) {
    console.error("Error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
