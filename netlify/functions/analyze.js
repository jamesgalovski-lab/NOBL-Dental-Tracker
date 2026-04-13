exports.config = { timeout: 30 };

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

const DENTAL_SYSTEM_PROMPT = `You are a veterinary dental screening assistant. Analyze buccal photos of dog teeth and return a JSON scoring object.

SCORING:
- tartar: 0=none, 1=mild, 2=moderate, 3=severe
- gingival: 0=healthy, 1=mild redness, 2=obvious redness, 3=severe
- structural: 0=intact, 1=minor, 2=moderate, 3=severe
- overall_risk: GREEN(0-2), YELLOW(3-5), ORANGE(6-7), RED(8-9)

IMPORTANT: Your entire response must be a single valid JSON object. Begin your response with { and end with }. Do not include any text before or after the JSON.`;

const NUTRITION_SYSTEM_PROMPT = `You are a canine nutrition advisor for oral health. Return dietary recommendations as JSON.

IMPORTANT: Your entire response must be a single valid JSON object. Begin your response with { and end with }. Do not include any text before or after the JSON.`;

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
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens || 1500,
      system: systemPrompt,
      messages
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error("Anthropic API " + res.status + ": " + err);
  }

  const data = await res.json();
  const text = data.content.filter(b => b.type === "text").map(b => b.text).join("");
  console.log("Claude raw response:", text.substring(0, 500));
  return text;
}

function extractJSON(text) {
  // Try 1: direct parse
  try { return JSON.parse(text.trim()); } catch(e) {}
  // Try 2: strip code fences
  try { return JSON.parse(text.replace(/```[\w]*\n?/g, "").trim()); } catch(e) {}
  // Try 3: extract outermost { }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch(e) {}
  }
  throw new Error("No valid JSON found in: " + text.substring(0, 200));
}

// Safe fallback dental result
function fallbackDental() {
  return {
    tartar: { right: 0, left: 0, composite: 0, notes: "Could not assess" },
    gingival: { right: 0, left: 0, composite: 0, notes: "Could not assess" },
    structural: { score: 0, notes: "Could not assess" },
    overall_risk: "YELLOW",
    composite_score: 3,
    image_quality: { right: "marginal", left: "marginal", notes: "Analysis incomplete" },
    key_findings: ["Analysis could not be completed — please retake photos in good lighting"],
    owner_summary: "We had trouble analysing these photos. Please try again with bright lighting and the cheek gently pulled back to show the back teeth clearly.",
    vet_urgency: "routine",
    nutrition_flags: [],
    confidence: "low"
  };
}

// Safe fallback nutrition result
function fallbackNutrition() {
  return {
    diet_assessment: "Unable to generate personalised recommendations at this time.",
    primary_recommendation: "Schedule a professional dental check with your vet for a full assessment.",
    food_recommendations: [
      { category: "chew", recommendation: "VOHC-accepted dental chews daily", priority: "high", vohc_approved: true }
    ],
    ingredients_to_seek: ["high-quality protein", "low simple carbohydrates"],
    ingredients_to_avoid: ["added sugars", "corn syrup"],
    home_care_tips: ["Brush teeth daily with dog-safe toothpaste", "Provide VOHC-approved dental chews"],
    recheck_days: 60,
    positive_note: "The fact that you are checking your dog's dental health puts you ahead of most pet owners!"
  };
}

function breedFlags(breed, age) {
  const b = (breed || "").toLowerCase();
  const flags = [];
  if (["chihuahua","yorkie","yorkshire","maltese","dachshund","pomeranian","shih tzu","bichon","miniature"].some(x => b.includes(x))) flags.push("small breed - high periodontal risk");
  if (["bulldog","pug","boston terrier","boxer"].some(x => b.includes(x))) flags.push("brachycephalic - crowding risk");
  if (parseFloat(age) >= 7) flags.push("senior dog");
  if (parseFloat(age) <= 2) flags.push("young dog - any tartar is an early warning");
  return flags.join(", ");
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

  const { dogProfile, images } = body;
  if (!dogProfile || !images || !images.right || !images.right.base64) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing required fields" }) };
  }

  const { breed, age, sex, weight, currentFood, dietType, treats, homeCare, bodyCondition, lastCleaning, symptoms } = dogProfile;

  console.log("Analysing dog:", breed, age, "yrs");
  console.log("Payload size:", Math.round(event.body.length / 1024), "KB");

  // ── Build dental prompt ──────────────────────────────────────────────────────
  const dentalContent = [];

  dentalContent.push({ type: "text", text: "RIGHT BUCCAL VIEW:" });
  dentalContent.push({ type: "image", source: { type: "base64", media_type: images.right.mediaType || "image/jpeg", data: images.right.base64 }});

  if (images.left && images.left.base64) {
    dentalContent.push({ type: "text", text: "LEFT BUCCAL VIEW:" });
    dentalContent.push({ type: "image", source: { type: "base64", media_type: images.left.mediaType || "image/jpeg", data: images.left.base64 }});
  }

  if (images.optionalFront && images.optionalFront.base64) {
    dentalContent.push({ type: "text", text: "FRONTAL VIEW:" });
    dentalContent.push({ type: "image", source: { type: "base64", media_type: images.optionalFront.mediaType || "image/jpeg", data: images.optionalFront.base64 }});
  }

  if (images.optionalLower && images.optionalLower.base64) {
    dentalContent.push({ type: "text", text: "LOWER BUCCAL VIEW:" });
    dentalContent.push({ type: "image", source: { type: "base64", media_type: images.optionalLower.mediaType || "image/jpeg", data: images.optionalLower.base64 }});
  }

  const flags = breedFlags(breed, age);
  dentalContent.push({ type: "text", text:
    `Dog: ${breed}, ${age}yrs, ${sex}${weight ? ", " + weight + "lbs" : ""}${flags ? " | " + flags : ""}
Food: ${currentFood || "unknown"} (${dietType || "unknown"})
Treats: ${treats || "none"} | Home care: ${homeCare || "none"}
Body condition: ${bodyCondition || "unknown"} | Last cleaning: ${lastCleaning || "unknown"}
Symptoms: ${symptoms && symptoms.length > 0 ? symptoms.join(", ") : "none"}

Analyse the buccal photos focusing on upper PM4 (carnassial) and M1.
Return a JSON object with these exact keys:
{
  "tartar": {"right": 0-3, "left": 0-3, "composite": 0-3, "notes": "string"},
  "gingival": {"right": 0-3, "left": 0-3, "composite": 0-3, "notes": "string"},
  "structural": {"score": 0-3, "notes": "string"},
  "overall_risk": "GREEN|YELLOW|ORANGE|RED",
  "composite_score": 0-9,
  "image_quality": {"right": "good|marginal|poor", "left": "good|marginal|poor", "notes": "string"},
  "key_findings": ["string"],
  "owner_summary": "2-3 warm sentences",
  "vet_urgency": "routine|soon|prompt|urgent",
  "nutrition_flags": ["string"],
  "confidence": "high|medium|low"
}`
  });

  // ── Run both analyses in parallel to save time ──────────────────────────────
  const nutritionPrompt = `Dog: ${breed}, ${age}yrs, ${sex}, food: ${currentFood} (${dietType}), treats: ${treats || "none"}, home care: ${homeCare || "none"}, symptoms: ${symptoms && symptoms.length > 0 ? symptoms.join(", ") : "none"}

Return a JSON object with these exact keys:
{
  "diet_assessment": "string",
  "primary_recommendation": "string",
  "food_recommendations": [{"category": "string", "recommendation": "string", "priority": "high|medium|low", "vohc_approved": true|false}],
  "ingredients_to_seek": ["string"],
  "ingredients_to_avoid": ["string"],
  "home_care_tips": ["string"],
  "recheck_days": 30|60|90,
  "positive_note": "string"
}`;

  const [dentalResult, nutritionResult] = await Promise.allSettled([
    callClaude(DENTAL_SYSTEM_PROMPT, [{ role: "user", content: dentalContent }], 1200),
    callClaude(NUTRITION_SYSTEM_PROMPT, [{ role: "user", content: nutritionPrompt }], 1000),
  ]);

  let dental = fallbackDental();
  let nutrition = fallbackNutrition();

  if (dentalResult.status === "fulfilled") {
    try { dental = extractJSON(dentalResult.value); console.log("Dental OK, risk:", dental.overall_risk); }
    catch (e) { console.error("Dental parse failed:", e.message); }
  } else {
    console.error("Dental call failed:", dentalResult.reason);
  }

  if (nutritionResult.status === "fulfilled") {
    try { nutrition = extractJSON(nutritionResult.value); console.log("Nutrition OK"); }
    catch (e) { console.error("Nutrition parse failed:", e.message); }
  } else {
    console.error("Nutrition call failed:", nutritionResult.reason);
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      success: true,
      dental,
      nutrition,
      meta: { analyzedAt: new Date().toISOString(), model: MODEL }
    }),
  };
};
