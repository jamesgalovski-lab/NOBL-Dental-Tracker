exports.config = { timeout: 30 };
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

const DENTAL_SYSTEM_PROMPT = `You are a veterinary dental screening assistant in a consumer wellness app. Analyze buccal photos of dog teeth. You are a screener, NOT a diagnostician.

CLINICAL FOCUS: Upper PM4 (carnassial) and M1 are primary indicators.

TARTAR (0-3): 0=none, 1=mild <25%, 2=moderate 25-75%, 3=severe >75%
GINGIVAL (0-3): 0=healthy pink, 1=mild redness, 2=obvious redness/swelling, 3=severe red/recession
STRUCTURAL (0-3): 0=intact, 1=minor chips, 2=fracture or missing, 3=severe damage
RISK: GREEN=0-2, YELLOW=3-5, ORANGE=6-7, RED=8-9

Never state specific diagnoses. Always recommend vet eval for non-zero gingival scores. Be warm and encouraging.

You MUST respond with ONLY a JSON object. No explanation, no markdown, no code fences. Start your response with { and end with }.

Required format:
{"tartar":{"right":0,"left":0,"composite":0,"notes":"brief note"},"gingival":{"right":0,"left":0,"composite":0,"notes":"brief note"},"structural":{"score":0,"notes":"brief note"},"overall_risk":"GREEN","composite_score":0,"image_quality":{"right":"good","left":"good","notes":"brief note"},"key_findings":["finding 1","finding 2"],"owner_summary":"2-3 warm plain-language sentences for the owner","vet_urgency":"routine","nutrition_flags":["flag1"],"confidence":"high"}`;

const NUTRITION_SYSTEM_PROMPT = `You are a canine nutrition advisor specializing in oral health. Give specific evidence-based recommendations. Only recommend VOHC-accepted products. Be warm and motivating.

You MUST respond with ONLY a JSON object. No explanation, no markdown, no code fences. Start your response with { and end with }.

Required format:
{"diet_assessment":"1-2 sentences on diet impact","primary_recommendation":"single most impactful change","food_recommendations":[{"category":"kibble","recommendation":"specific advice","priority":"high","vohc_approved":true}],"ingredients_to_seek":["ingredient 1"],"ingredients_to_avoid":["ingredient 1"],"home_care_tips":["tip 1","tip 2"],"recheck_days":60,"positive_note":"one encouraging sentence"}`;

async function callClaude(systemPrompt, messages, maxTokens) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set in environment variables");

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
  return data.content.filter(b => b.type === "text").map(b => b.text).join("");
}

function safeParseJSON(text) {
  // Log raw response for debugging
  console.log("Raw Claude response (first 200 chars):", text.substring(0, 200));

  // Strategy 1: direct parse
  try { return JSON.parse(text.trim()); } catch(e) {}

  // Strategy 2: strip markdown fences
  let cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try { return JSON.parse(cleaned); } catch(e) {}

  // Strategy 3: extract first { ... } block
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch(e) {}
  }

  // Strategy 4: find JSON start/end manually
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(text.substring(start, end + 1)); } catch(e) {}
  }

  throw new Error("Could not parse JSON from Claude response: " + text.substring(0, 300));
}

function breedContext(breed, age, sex, weight) {
  const b = (breed||"").toLowerCase();
  let ctx = "Breed: " + breed + " | Age: " + age + " yrs | Sex: " + sex;
  if (weight) ctx += " | Weight: " + weight + "lbs";
  if (["chihuahua","yorkie","yorkshire","maltese","dachshund","pomeranian","shih tzu","bichon"].some(x=>b.includes(x))) ctx += " | FLAG: small breed high perio risk";
  if (["bulldog","pug","boston terrier","boxer","shih tzu"].some(x=>b.includes(x))) ctx += " | FLAG: brachycephalic crowding risk";
  if (parseFloat(age)>=7) ctx += " | FLAG: senior dog";
  if (parseFloat(age)<=2) ctx += " | FLAG: young dog - tartar is early warning";
  return ctx;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: JSON.stringify({error:"Method not allowed"}) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({error:"Invalid JSON body"}) }; }

  const { dogProfile, images } = body;
  if (!dogProfile || !images || !images.right || !images.right.base64) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({error:"Missing dogProfile or images.right.base64"}) };
  }

  // Log incoming payload size for debugging
  const payloadSize = Math.round((event.body || '').length / 1024);
  console.log("Payload size:", payloadSize, "KB");

  try {
    const { breed, age, sex, weight, currentFood, dietType, treats, homeCare, bodyCondition, lastCleaning, symptoms } = dogProfile;

    // Build image content blocks
    const content = [];

    content.push({ type:"text", text:"RIGHT BUCCAL VIEW (right side, upper premolars and carnassial tooth):" });
    content.push({ type:"image", source:{ type:"base64", media_type: images.right.mediaType || "image/jpeg", data: images.right.base64 }});

    if (images.left && images.left.base64) {
      content.push({ type:"text", text:"LEFT BUCCAL VIEW (left side, upper premolars and carnassial tooth):" });
      content.push({ type:"image", source:{ type:"base64", media_type: images.left.mediaType || "image/jpeg", data: images.left.base64 }});
    }

    if (images.optionalFront && images.optionalFront.base64) {
      content.push({ type:"text", text:"OPTIONAL FRONTAL VIEW:" });
      content.push({ type:"image", source:{ type:"base64", media_type: images.optionalFront.mediaType || "image/jpeg", data: images.optionalFront.base64 }});
    }

    if (images.optionalLower && images.optionalLower.base64) {
      content.push({ type:"text", text:"OPTIONAL LOWER BUCCAL VIEW:" });
      content.push({ type:"image", source:{ type:"base64", media_type: images.optionalLower.mediaType || "image/jpeg", data: images.optionalLower.base64 }});
    }

    content.push({ type:"text", text:
      breedContext(breed, age, sex, weight) +
      "\nFood: " + (currentFood||"unknown") + " (" + (dietType||"unknown") + ")" +
      "\nTreats: " + (treats||"none") +
      "\nHome care: " + (homeCare||"none") +
      "\nBody condition: " + (bodyCondition||"unknown") +
      "\nLast cleaning: " + (lastCleaning||"unknown") +
      "\nSymptoms: " + (symptoms&&symptoms.length>0 ? symptoms.join(", ") : "none") +
      "\n\nAnalyze the buccal photos focusing on upper PM4 and M1. Respond with JSON only — no markdown, no explanation, just the JSON object."
    });

    // Dental analysis
    const dentalText = await callClaude(DENTAL_SYSTEM_PROMPT, [{role:"user", content}], 1500);
    const dental = safeParseJSON(dentalText);

    // Nutrition recommendations
    const nutritionText = await callClaude(
      NUTRITION_SYSTEM_PROMPT,
      [{role:"user", content:
        "Dental results: " + JSON.stringify(dental) +
        "\nDog: " + breed + ", " + age + "yrs, " + sex +
        ", Food: " + (currentFood||"unknown") + " (" + (dietType||"unknown") + ")" +
        ", Treats: " + (treats||"none") +
        ", Home care: " + (homeCare||"none") +
        ", Symptoms: " + (symptoms&&symptoms.length>0?symptoms.join(", "):"none") +
        "\n\nRespond with JSON only — no markdown, no explanation, just the JSON object."
      }],
      1200
    );
    const nutrition = safeParseJSON(nutritionText);

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

  } catch (err) {
    console.error("Handler error:", err.message);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
