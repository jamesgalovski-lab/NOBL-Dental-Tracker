exports.config = { timeout: 30 };

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

const CARB_TABLE = {
  "dry kibble":           { carb_pct: 52, fermentation: "fast",      moisture: 10, oral_health_base: 4 },
  "wet/canned food":      { carb_pct: 30, fermentation: "moderate",  moisture: 78, oral_health_base: 6 },
  "raw diet":             { carb_pct: 8,  fermentation: "slow",      moisture: 70, oral_health_base: 8 },
  "mixed kibble and wet": { carb_pct: 42, fermentation: "moderate",  moisture: 35, oral_health_base: 5 },
  "prescription diet":    { carb_pct: 38, fermentation: "moderate",  moisture: 10, oral_health_base: 6 },
  "home cooked":          { carb_pct: 25, fermentation: "variable",  moisture: 60, oral_health_base: 7 },
  "air dried":            { carb_pct: 25, fermentation: "slow",      moisture: 12, oral_health_base: 7 },
  "freeze dried":         { carb_pct: 10, fermentation: "very slow", moisture: 3,  oral_health_base: 9 },
  "semi-moist":           { carb_pct: 45, fermentation: "very fast", moisture: 25, oral_health_base: 3 },
};

function getDietData(dietType) {
  const key = (dietType || "").toLowerCase().trim();
  for (const [k, v] of Object.entries(CARB_TABLE)) {
    if (key.includes(k) || k.includes(key)) return { ...v, key: k };
  }
  return { carb_pct: 40, fermentation: "moderate", moisture: 20, oral_health_base: 5, key: "unknown" };
}

const DENTAL_SYSTEM_PROMPT = `You are a veterinary dental screening assistant. Analyze buccal photos of dog teeth.

CLINICAL FOCUS: Upper PM4 (carnassial) and M1 are primary indicators.
TARTAR (0-3): 0=none, 1=mild <25%, 2=moderate 25-75%, 3=severe >75%
GINGIVAL (0-3): 0=healthy pink, 1=mild redness, 2=obvious swelling, 3=severe/recession
STRUCTURAL (0-3): 0=intact, 1=minor chips, 2=fracture or missing, 3=severe
RISK: GREEN=0-2, YELLOW=3-5, ORANGE=6-7, RED=8-9

Never state specific diagnoses. Be a screener, not a diagnostician.
Respond with ONLY a raw JSON object. Start with { end with }. No markdown.`;

const NUTRITION_SYSTEM_PROMPT = `You are writing the nutrition section of a canine dental screening report. Your voice is that of a knowledgeable friend who happens to be a veterinary dental specialist — warm, caring, conversational, genuinely helpful. You never talk down to the owner. You always use the dog's name.

TONE — NON-NEGOTIABLE:
- Never give orders. Suggest, invite, wonder. Use phrases like "you might want to consider...", "one thing worth trying could be...", "it might be worth a chat with your vet about..."
- Every suggestion must explain WHY in plain language — the mechanism, never a lecture
- Use the dog's name throughout
- Severity calibration: GREEN = cheerful and encouraging; YELLOW = gentle caring nudge; ORANGE = clear and caring, a friend who needs you to hear this; RED = warm but firm and serious — this matters

NUTRITIONAL SCIENCE:
- Carbs ferment into acids within minutes, dropping oral pH below 5.5 (enamel demineralization threshold)
- Each meal = one acid attack. Free feeding = continuous acid exposure all day
- High-quality animal protein supports gum tissue via collagen precursors
- Soft/glycerin-containing treats coat teeth and feed bacteria directly
- Sodium hexametaphosphate (HMP) chelates calcium preventing calculus — VOHC mechanism
- Ascophyllum nodosum (seaweed kelp) has VOHC acceptance for plaque/tartar reduction
- Small breeds: every dietary factor is amplified due to tooth crowding

OHDS SCORING (base from diet format, then adjust):
- Feeding once daily: +0.5; twice daily: 0; free fed: -2.0
- High-quality animal protein: +0.5; plant-based only: -0.5
- Soft/sugary treats daily: -1.5; table scraps: -1.0; VOHC dental chews only: +0.5; no treats: +0.5
- Daily brushing: +1.5; occasional brushing: +0.5; water additive: +0.5; enzymatic toothpaste: +0.5
- Professional cleaning within a year: +0.5; never/unknown: -0.5
Cap between 1 and 10.

Respond with ONLY a raw JSON object. Start with { end with }. No markdown.`;

async function callClaude(systemPrompt, messages, maxTokens) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens || 1200, system: systemPrompt, messages }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error("Anthropic API " + res.status + ": " + err);
  }

  const data = await res.json();
  const text = data.content.filter(b => b.type === "text").map(b => b.text).join("");
  console.log("Response preview:", text.substring(0, 150));
  return text;
}

function extractJSON(text) {
  try { return JSON.parse(text.trim()); } catch(e) {}
  try { return JSON.parse(text.replace(/```[\w]*\n?/g, "").trim()); } catch(e) {}
  const s = text.indexOf("{"), e2 = text.lastIndexOf("}");
  if (s !== -1 && e2 > s) { try { return JSON.parse(text.slice(s, e2 + 1)); } catch(e) {} }
  throw new Error("No JSON found: " + text.substring(0, 100));
}

function fallbackDental() {
  return {
    tartar: { right: 0, left: 0, composite: 0, notes: "Could not assess" },
    gingival: { right: 0, left: 0, composite: 0, notes: "Could not assess" },
    structural: { score: 0, notes: "Could not assess" },
    overall_risk: "YELLOW", composite_score: 3,
    image_quality: { right: "marginal", left: "marginal", notes: "Retake in bright light" },
    key_findings: ["Photos were unclear — please retake outdoors in natural light with cheek gently pulled back"],
    owner_summary: "We couldn't get a clear enough read from these photos. Try again outside in bright light with the cheek pulled back so the large back tooth is clearly visible.",
    vet_urgency: "routine", nutrition_flags: [], confidence: "low"
  };
}

function fallbackNutrition(dogName, dietType) {
  const dd = getDietData(dietType);
  return {
    ohds_score: dd.oral_health_base,
    estimated_carb_pct: dd.carb_pct,
    diet_oral_health_rating: "fair",
    diet_assessment: `We weren't able to complete the full nutritional analysis for ${dogName} this time, but the dental scores above still give you a useful picture.`,
    diet_mechanism: "The type of food a dog eats has a direct effect on their teeth. Carbohydrates are fermented by oral bacteria into acids within minutes of eating — and those acids are what drive plaque and tartar formation.",
    treat_analysis: "Treats are often the hidden factor in oral health. Even a great main diet can be undermined by soft or sugary treats given regularly.",
    oral_ph_impact: "When oral pH drops below 5.5, enamel starts to demineralise. Diet is the biggest driver of how often that happens.",
    primary_recommendation: `A conversation with your vet about ${dogName}'s diet at the next check-up would be really worthwhile.`,
    food_recommendations: [{ category: "Dental chews", recommendation: `If ${dogName} isn't already getting a daily dental chew, it might be worth looking into VOHC-accepted options — they've been independently tested and shown to actually reduce plaque or tartar.`, priority: "medium", vohc_approved: true, mechanism: "The VOHC seal means independent clinical testing confirmed the product works as claimed." }],
    ingredients_to_seek: ["sodium hexametaphosphate (HMP)", "Ascophyllum nodosum (seaweed)", "zinc compounds"],
    ingredients_to_avoid: ["corn syrup or molasses", "glycerin as primary ingredient", "carrageenan"],
    home_care_tips: [`Even brushing ${dogName}'s teeth a few times a week with enzymatic toothpaste can make a real difference.`],
    action_plan_intro: `Here's a gentle suggested path forward for ${dogName}.`,
    action_plan: { day_30: "Review treat types and frequency", day_60: "Consider discussing dental diet options with your vet", day_90: "Rescan with DentalPaw to track progress" },
    recheck_days: 60,
    positive_note: `The fact that you're paying attention to ${dogName}'s dental health already puts you well ahead of most dog owners.`
  };
}

function breedFlags(breed, age) {
  const b = (breed || "").toLowerCase();
  const flags = [];
  if (["chihuahua","yorkie","yorkshire","maltese","dachshund","pomeranian","shih tzu","bichon","miniature"].some(x => b.includes(x)))
    flags.push("SMALL BREED: elevated periodontal risk, all dietary factors amplified");
  if (["bulldog","pug","boston terrier","boxer"].some(x => b.includes(x)))
    flags.push("BRACHYCEPHALIC: crowding increases plaque trapping");
  if (parseFloat(age) >= 7) flags.push("SENIOR: heightened periodontal risk");
  if (parseFloat(age) <= 2) flags.push("YOUNG: any significant tartar is an early warning");
  return flags;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid request body" }) }; }

  const { dogProfile, images, mode } = body;

  if (!dogProfile) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing dogProfile" }) };

  const {
    name, breed, age, sex, weight,
    currentFood, dietType, treats, treatFrequency, feedingSchedule, proteinSource,
    homeCare, bodyCondition, lastCleaning, symptoms
  } = dogProfile;

  const dogName = name && name !== "Your dog" ? name : "your dog";
  const dietData = getDietData(dietType);
  const flags = breedFlags(breed, age);

  // ── MODE: dental — photo analysis only ──────────────────────────────────────
  if (mode === "dental") {
    if (!images || !images.right || !images.right.base64) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing images for dental mode" }) };
    }

    console.log("DENTAL MODE:", breed, age + "yrs | Payload:", Math.round(event.body.length/1024) + "KB");

    const content = [];
    content.push({ type: "text", text: "RIGHT BUCCAL VIEW:" });
    content.push({ type: "image", source: { type: "base64", media_type: images.right.mediaType || "image/jpeg", data: images.right.base64 }});

    if (images.left?.base64) {
      content.push({ type: "text", text: "LEFT BUCCAL VIEW:" });
      content.push({ type: "image", source: { type: "base64", media_type: images.left.mediaType || "image/jpeg", data: images.left.base64 }});
    }
    if (images.optionalFront?.base64) {
      content.push({ type: "text", text: "FRONTAL VIEW:" });
      content.push({ type: "image", source: { type: "base64", media_type: images.optionalFront.mediaType || "image/jpeg", data: images.optionalFront.base64 }});
    }
    if (images.optionalLower?.base64) {
      content.push({ type: "text", text: "LOWER VIEW:" });
      content.push({ type: "image", source: { type: "base64", media_type: images.optionalLower.mediaType || "image/jpeg", data: images.optionalLower.base64 }});
    }

    content.push({ type: "text", text:
      `Dog: ${breed}, ${age}yrs, ${sex}${weight ? ", " + weight + "lbs" : ""}
${flags.length > 0 ? "Flags: " + flags.join("; ") : ""}
Food: ${currentFood || "unknown"} (${dietType})
Symptoms: ${symptoms?.length > 0 ? symptoms.join(", ") : "none"}

Return JSON:
{"tartar":{"right":0,"left":0,"composite":0,"notes":""},"gingival":{"right":0,"left":0,"composite":0,"notes":""},"structural":{"score":0,"notes":""},"overall_risk":"GREEN","composite_score":0,"image_quality":{"right":"good","left":"good","notes":""},"key_findings":[""],"owner_summary":"2-3 warm sentences using dog name ${dogName}","vet_urgency":"routine","nutrition_flags":[""],"confidence":"high"}`
    });

    let dental = fallbackDental();
    try {
      const text = await callClaude(DENTAL_SYSTEM_PROMPT, [{ role: "user", content }], 1000);
      dental = extractJSON(text);
      console.log("Dental OK:", dental.overall_risk);
    } catch(e) { console.error("Dental error:", e.message); }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true, dental, meta: { mode: "dental", analyzedAt: new Date().toISOString() } }),
    };
  }

  // ── MODE: nutrition — no images, uses dental results ────────────────────────
  if (mode === "nutrition") {
    const { dentalResults } = body;
    if (!dentalResults) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing dentalResults for nutrition mode" }) };

    console.log("NUTRITION MODE:", breed, age + "yrs, OHDS base:", dietData.oral_health_base);

    const nutritionPrompt =
`DOG NAME: ${dogName}
BREED: ${breed} | AGE: ${age}yrs | SEX: ${sex}${weight ? " | " + weight + "lbs" : ""}
FLAGS: ${flags.length > 0 ? flags.join("; ") : "none"}
DENTAL FINDINGS: Overall risk ${dentalResults.overall_risk}, composite ${dentalResults.composite_score}/9
Tartar: ${dentalResults.tartar?.composite}/3, Gums: ${dentalResults.gingival?.composite}/3, Structure: ${dentalResults.structural?.score}/3
Key findings: ${(dentalResults.key_findings || []).join("; ")}

DIET: ${currentFood} (${dietType}) | Est. carbs: ~${dietData.carb_pct}% | Fermentation: ${dietData.fermentation} | Moisture: ~${dietData.moisture}%
Base oral health score for this diet format: ${dietData.oral_health_base}/10
Protein source: ${proteinSource || "unknown"}
Feeding schedule: ${feedingSchedule || "unknown"}
Treats: ${treats || "none"} | Frequency: ${treatFrequency || "unknown"}
Home care: ${homeCare || "none"}
Body condition: ${bodyCondition || "unknown"}
Last cleaning: ${lastCleaning || "unknown"}
Symptoms: ${symptoms?.length > 0 ? symptoms.join(", ") : "none"}

Write the nutrition analysis in the warm veterinary friend tone. Calculate the OHDS score. Use ${dogName}'s name throughout.

Return JSON:
{"ohds_score":5,"estimated_carb_pct":40,"diet_oral_health_rating":"fair","diet_assessment":"","diet_mechanism":"","treat_analysis":"","oral_ph_impact":"","primary_recommendation":"","food_recommendations":[{"category":"","recommendation":"","priority":"medium","vohc_approved":false,"mechanism":""}],"ingredients_to_seek":[""],"ingredients_to_avoid":[""],"home_care_tips":[""],"action_plan_intro":"","action_plan":{"day_30":"","day_60":"","day_90":""},"recheck_days":60,"positive_note":""}`;

    let nutrition = fallbackNutrition(dogName, dietType);
    try {
      const text = await callClaude(NUTRITION_SYSTEM_PROMPT, [{ role: "user", content: nutritionPrompt }], 1400);
      nutrition = extractJSON(text);
      console.log("Nutrition OK, OHDS:", nutrition.ohds_score);
    } catch(e) { console.error("Nutrition error:", e.message); }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true, nutrition, meta: { mode: "nutrition", analyzedAt: new Date().toISOString(), dietData } }),
    };
  }

  return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid mode. Use 'dental' or 'nutrition'." }) };
};
