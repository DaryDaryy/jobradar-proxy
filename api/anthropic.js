export const config = {
  api: { bodyParser: true },
};

const GEMINI_KEY = process.env.GEMINI_API_KEY;

// Remotive - free, no key needed
async function fetchRemotive(tag) {
  const url = `https://remotive.com/api/remote-jobs?category=${encodeURIComponent(tag)}&limit=20`;
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!res.ok) { console.error("Remotive error:", res.status); return []; }
  const data = await res.json();
  return (data.jobs || []).map(j => ({
    title: j.title,
    company: j.company_name,
    location: j.candidate_required_location || "Remote (Worldwide)",
    description: j.description?.replace(/<[^>]*>/g, "").slice(0, 250) || "",
    url: j.url,
    postedDate: j.publication_date?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    salary: j.salary || null,
  }));
}

// Jobicy - free, no key needed
async function fetchJobicy(tag) {
  const url = `https://jobicy.com/api/v2/remote-jobs?tag=${encodeURIComponent(tag)}&count=20`;
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!res.ok) { console.error("Jobicy error:", res.status); return []; }
  const data = await res.json();
  return (data.jobs || []).map(j => ({
    title: j.jobTitle,
    company: j.companyName,
    location: j.jobGeo || "Remote (Worldwide)",
    description: j.jobExcerpt?.slice(0, 250) || "",
    url: j.url,
    postedDate: j.pubDate?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    salary: j.annualSalaryMin ? `$${Math.round(j.annualSalaryMin/1000)}k-$${Math.round(j.annualSalaryMax/1000)}k` : null,
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
  console.log("Gemini length:", text.length, "| start:", text.slice(0, 80));
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

    // Excluded companies
    const seenMatch = userMsg.match(/EXCLUDE_COMPANIES:\[([^\]]*)\]/);
    const excluded = seenMatch
      ? seenMatch[1].split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
      : [];

    console.log("Role:", roleLabel, "| Excluded:", excluded.length);

    // Fetch real jobs from Remotive + Jobicy
    let allJobs = [];
    const tag = isProduct ? "product" : "project-management";
    try {
      const [remotive, jobicy] = await Promise.all([
        fetchRemotive(tag),
        fetchJobicy(isProduct ? "product+manager" : "project+manager"),
      ]);
      allJobs = [...remotive, ...jobicy];
      console.log("Raw jobs fetched:", allJobs.length);

      // Deduplicate by company, exclude already seen
      const seen = new Set(excluded);
      allJobs = allJobs.filter(j => {
        const k = (j.company || "").toLowerCase().trim();
        if (!k || k === "unknown") return false;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      console.log("Unique new jobs:", allJobs.length);
    } catch(e) {
      console.error("Job fetch error:", e.message);
    }

    const today = new Date().toISOString().slice(0, 10);

    const jobsContext = allJobs.length > 0
      ? allJobs.slice(0, 25).map((j, i) =>
          `${i+1}. "${j.title}" at ${j.company} | ${j.location} | Posted: ${j.postedDate}${j.salary ? " | " + j.salary : ""}\n   ${j.description}\n   URL: ${j.url}`
        ).join("\n\n")
      : "No live results available right now.";

    const prompt = `You are a job matching expert. From the REAL job listings below, select the best 8 matches for this candidate.

CANDIDATE: Daria Kalinina, ${roleLabel}, Yerevan Armenia, seeking remote international roles. 4+ yrs PM, 9+ yrs tech. AI SaaS founder (6k users), PM OZON.ru (notifications), PM systeme.io Ireland (English, 500k users, Website Editor), Lead PjM Zvuk/Sber (10 engineers, Python/K8s). Figma, Jira, SQL, Python, Tableau, Amplitude, Scrum. English B2/C1.

REAL JOB LISTINGS (from Remotive.com and Jobicy.com):
${jobsContext}

Pick the 8 best matches based on skills fit. Use ONLY the real data above — real company names, real URLs, real posted dates.

Respond with ONLY a JSON array, nothing else, starting with [ and ending with ]:
[{"id":"1","company":"RealCompany","role":"Real Job Title","type":"${roleType}","location":"Remote (Region)","description":"2 sentence summary of the real job.","email":"","url":"real-url-from-above","matchScore":85,"matchReason":"Specific skills match","postedDate":"real-date-from-above"}]

Rules: exactly 8 items, type="${roleType}" for ALL, matchScore 70-95, use real data from listings.`;

    const text = await gemini(prompt);
    return res.status(200).json({ content: [{ type: "text", text }] });

  } catch (error) {
    console.error("Error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
