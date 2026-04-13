exports.config = { timeout: 30 };

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

const DENTAL_SYSTEM_PROMPT = `You are a veterinary dental screening assistant. Analyze buccal photos of dog teeth and return a JSON scoring object.

SCORING:
- tartar: 0=none, 1=mild <25%, 2=moderate 25-75%, 3=severe >75%
- gingival: 0=healthy pink, 1=mild redness, 2=obvious redness/swelling, 3=severe/recession
- structural: 0=intact, 1=minor chips, 2=fracture or missing, 3=severe damage
- overall_risk: GREEN(0-2), YELLOW(3-5), ORANGE(6-7), RED(8-9)

Focus on upper PM4 (carnassial) and M1 as primary indicators. Never diagnose. Be warm.
IMPORTANT: Respond with ONLY a JSON object. Start with { end with }. No markdown.`;

const NUTRITION_SYSTEM_PROMPT = `You are a specialist in canine oral health nutrition. Provide deeply specific, evidence-based dietary analysis and recommendations based on dental findings and the dog's complete profile.

YOUR ROLE:
- Explain the MECHANISM connecting their diet to the dental findings (e.g. "Soft wet food leaves fermentable carbohydrates coating tooth surfaces, accelerating plaque biofilm formation within hours of eating")
- Rate their current diet's impact on oral health (poor/fair/good/excellent)
- Identify the single highest-impact dietary change
- Give specific guidance on food FORMAT (kibble vs wet vs raw) and its oral health implications
- Address treats separately — treat sugar and soft texture are often the hidden culprit
- Provide VOHC-category recommendations matched to risk level
- For small breeds, emphasize the periodontal risk amplification
- Give ingredient-level guidance: what enzymes, proteins, or additives help vs harm
- Explain the oral pH mechanism and how diet affects it
- Provide a 30/60/90 day action plan with measurable milestones

IMPORTANT: Respond with ONLY a JSON object. Start with { end with }. No markdown.`;

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
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens || 1500, system: systemPrompt, messages }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error("Anthropic API " + res.status + ": " + err);
  }

  const data = await res.json();
  const text = data.content.filter(b => b.type === "text").map(b => b.text).join("");
  console.log("Response preview:", text.substring(0, 300));
  return text;
}

function extractJSON(text) {
  try { return JSON.parse(text.trim()); } catch(e) {}
  try { return JSON.parse(text.replace(/```[\w]*\n?/g, "").trim()); } catch(e) {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch(e) {}
  }
  throw new Error("No valid JSON found: " + text.substring(0, 200));
}

function fallbackDental() {
  return {
    tartar: { right: 0, left: 0, composite: 0, notes: "Could not assess" },
    gingival: { right: 0, left: 0, composite: 0, notes: "Could not assess" },
    structural: { score: 0, notes: "Could not assess" },
    overall_risk: "YELLOW", composite_score: 3,
    image_quality: { right: "marginal", left: "marginal", notes: "Analysis incomplete" },
    key_findings: ["Photos could not be fully analysed — please retake in bright natural light with cheek gently pulled back"],
    owner_summary: "We had difficulty analysing these photos clearly. Try again outdoors in natural light for best results.",
    vet_urgency: "routine", nutrition_flags: [], confidence: "low"
  };
}

function fallbackNutrition() {
  return {
    diet_assessment: "Unable to generate personalised analysis at this time.",
    diet_oral_health_rating: "unknown",
    diet_mechanism: "A full dietary analysis requires a successful photo scan.",
    primary_recommendation: "Schedule a professional dental check with your vet.",
    treat_analysis: "Treats can significantly impact oral health — dental chews with the VOHC seal are recommended.",
    oral_ph_impact: "Diet directly influences oral pH, which affects bacterial growth and plaque formation.",
    food_recommendations: [
      { category: "chew", recommendation: "VOHC-accepted dental chews daily", priority: "high", vohc_approved: true, mechanism: "Mechanical abrasion reduces plaque" }
    ],
    ingredients_to_seek: ["high-quality protein", "low simple carbohydrates", "sodium hexametaphosphate"],
    ingredients_to_avoid: ["added sugars", "corn syrup", "artificial colours"],
    home_care_tips: ["Brush daily with enzymatic dog toothpaste", "Add VOHC-accepted water additive"],
    action_plan: {
      day_30: "Start daily dental chews and introduce tooth brushing",
      day_60: "Reassess food type — consider dental kibble if tartar present",
      day_90: "Rescan with DentalPaw to measure improvement"
    },
    recheck_days: 60,
    positive_note: "Checking your dog's dental health already puts you ahead of most pet owners!"
  };
}

function breedFlags(breed, age) {
  const b = (breed || "").toLowerCase();
  const flags = [];
  if (["chihuahua","yorkie","yorkshire","maltese","dachshund","pomeranian","shih tzu","bichon","miniature"].some(x => b.includes(x))) flags.push("small breed - elevated periodontal risk due to crowding");
  if (["bulldog","pug","boston terrier","boxer"].some(x => b.includes(x))) flags.push("brachycephalic - dental crowding and malocclusion common");
  if (parseFloat(age) >= 7) flags.push("senior dog - heightened risk, findings should be taken seriously");
  if (parseFloat(age) <= 2) flags.push("young dog - any significant tartar is an early warning sign");
  return flags.join("; ");
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
  console.log("Analysing:", breed, age + "yrs", "| Payload:", Math.round(event.body.length / 1024) + "KB");

  const dentalContent = [];
  dentalContent.push({ type: "text", text: "RIGHT BUCCAL VIEW:" });
  dentalContent.push({ type: "image", source: { type: "base64", media_type: images.right.mediaType || "image/jpeg", data: images.right.base64 }});

  if (images.left?.base64) {
    dentalContent.push({ type: "text", text: "LEFT BUCCAL VIEW:" });
    dentalContent.push({ type: "image", source: { type: "base64", media_type: images.left.mediaType || "image/jpeg", data: images.left.base64 }});
  }
  if (images.optionalFront?.base64) {
    dentalContent.push({ type: "text", text: "FRONTAL VIEW:" });
    dentalContent.push({ type: "image", source: { type: "base64", media_type: images.optionalFront.mediaType || "image/jpeg", data: images.optionalFront.base64 }});
  }
  if (images.optionalLower?.base64) {
    dentalContent.push({ type: "text", text: "LOWER BUCCAL VIEW:" });
    dentalContent.push({ type: "image", source: { type: "base64", media_type: images.optionalLower.mediaType || "image/jpeg", data: images.optionalLower.base64 }});
  }

  const flags = breedFlags(breed, age);
  dentalContent.push({ type: "text", text:
    `Dog: ${breed}, ${age}yrs, ${sex}${weight ? ", " + weight + "lbs" : ""}${flags ? " | " + flags : ""}
Food: ${currentFood || "unknown"} (${dietType || "unknown"}) | Treats: ${treats || "none"}
Home care: ${homeCare || "none"} | Body condition: ${bodyCondition || "unknown"}
Last cleaning: ${lastCleaning || "unknown"} | Symptoms: ${symptoms?.length > 0 ? symptoms.join(", ") : "none"}

Analyse photos. Focus on upper PM4 and M1. Return JSON:
{"tartar":{"right":0,"left":0,"composite":0,"notes":""},"gingival":{"right":0,"left":0,"composite":0,"notes":""},"structural":{"score":0,"notes":""},"overall_risk":"GREEN","composite_score":0,"image_quality":{"right":"good","left":"good","notes":""},"key_findings":[""],"owner_summary":"","vet_urgency":"routine","nutrition_flags":[""],"confidence":"high"}`
  });

  const nutritionUserPrompt =
    `Dental findings: ${JSON.stringify({ tartar: "see below", overall_risk: "see below" })}
Dog profile: ${breed}, ${age}yrs, ${sex}${weight ? ", " + weight + "lbs" : ""}
Diet: ${currentFood || "unknown"} — type: ${dietType || "unknown"}
Treats: ${treats || "none specified"}
Home dental care: ${homeCare || "none"}
Body condition: ${bodyCondition || "unknown"}
Breed flags: ${flags || "none"}
Symptoms: ${symptoms?.length > 0 ? symptoms.join(", ") : "none"}

Provide deep nutrition analysis. Return JSON:
{"diet_assessment":"","diet_oral_health_rating":"poor|fair|good|excellent","diet_mechanism":"explain HOW this diet type affects oral health at a biological level","primary_recommendation":"","treat_analysis":"specific analysis of their treat choices and oral health impact","oral_ph_impact":"how their diet affects oral pH and bacterial environment","food_recommendations":[{"category":"","recommendation":"","priority":"high|medium|low","vohc_approved":true,"mechanism":"why this helps"}],"ingredients_to_seek":[""],"ingredients_to_avoid":[""],"home_care_tips":[""],"action_plan":{"day_30":"","day_60":"","day_90":""},"recheck_days":60,"positive_note":""}`;

  const [dentalResult, nutritionResult] = await Promise.allSettled([
    callClaude(DENTAL_SYSTEM_PROMPT, [{ role: "user", content: dentalContent }], 1200),
    callClaude(NUTRITION_SYSTEM_PROMPT, [{ role: "user", content: nutritionUserPrompt }], 1200),
  ]);

  let dental = fallbackDental();
  let nutrition = fallbackNutrition();

  if (dentalResult.status === "fulfilled") {
    try { dental = extractJSON(dentalResult.value); }
    catch (e) { console.error("Dental parse error:", e.message); }
  } else { console.error("Dental call error:", dentalResult.reason?.message); }

  if (nutritionResult.status === "fulfilled") {
    try { nutrition = extractJSON(nutritionResult.value); }
    catch (e) { console.error("Nutrition parse error:", e.message); }
  } else { console.error("Nutrition call error:", nutritionResult.reason?.message); }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ success: true, dental, nutrition, meta: { analyzedAt: new Date().toISOString(), model: MODEL } }),
  };
};
