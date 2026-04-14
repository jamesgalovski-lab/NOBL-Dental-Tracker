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
  "freeze-dried":         { carb_pct: 10, fermentation: "very slow", moisture: 3,  oral_health_base: 9 },
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

const DENTAL_SYSTEM_PROMPT = `You are a veterinary dental screening assistant for NOBL Dental Tracker. Analyze buccal photos of dog teeth.

CLINICAL FOCUS: Upper PM4 (carnassial) and M1 are primary indicators.
TARTAR (0-3): 0=none, 1=mild <25%, 2=moderate 25-75%, 3=severe >75%
GINGIVAL (0-3): 0=healthy pink, 1=mild redness, 2=obvious swelling, 3=severe/recession
STRUCTURAL (0-3): 0=intact, 1=minor chips, 2=fracture or missing, 3=severe
RISK: GREEN=0-2, YELLOW=3-5, ORANGE=6-7, RED=8-9

KEY FINDINGS TONE — CRITICAL:
Each finding must have TWO layers in a single sentence or two:
1. The clinical observation (what you see)
2. What it actually means in plain, warm, friend-to-friend language — as if a vet friend is explaining it over coffee, not writing a chart note.

Examples of the right tone:
- WRONG: "Moderate calculus accumulation noted on upper carnassial bilaterally."
- RIGHT: "There's a moderate layer of tartar building up on the big back teeth on both sides — that's the tooth that does most of the heavy chewing, so it tends to collect the most buildup and is the one vets watch most closely."
- WRONG: "Mild gingival inflammation present."
- RIGHT: "The gums look a little pink and puffy along the gumline — that's early gingivitis, and the good news is it's fully reversible at this stage with regular brushing."
- WRONG: "Asymmetric tartar noted."
- RIGHT: "The right side has noticeably more buildup than the left — dogs often chew more on one side, sometimes because the other side is a bit sore. Worth mentioning to your vet."

owner_summary should use the dog's name and the same warm friend tone.
Never state specific diagnoses. Be a screener, not a diagnostician.
Respond with ONLY a raw JSON object. Start with { end with }. No markdown.`;

// ── NUTRITION SYSTEM PROMPT ────────────────────────────────────────────────
// CHANGED: Removed OHDS scoring instructions (no longer displayed in the UI).
// CHANGED: Added format_callout and format_risk_flags instructions.
// KEPT:    All tone, science, and breed guidance unchanged.
const NUTRITION_SYSTEM_PROMPT = `You are writing the nutrition section of a canine dental screening report for NOBL Dental Tracker. Your voice is that of a knowledgeable friend who happens to be a veterinary dental specialist — warm, caring, conversational, genuinely helpful. You never talk down to the owner. You always use the dog's name.

TONE — NON-NEGOTIABLE:
- Never give orders. Suggest, invite, wonder. Use phrases like "you might want to consider…", "one thing worth trying could be…", "it might be worth a chat with your vet about…"
- Every suggestion must explain WHY in plain language — the mechanism, never a lecture
- Use the dog's name throughout
- Severity calibration: GREEN = cheerful and encouraging; YELLOW = gentle caring nudge; ORANGE = clear and caring, a friend who needs you to hear this; RED = warm but firm and serious — this matters
- The goal of the nutrition section is to INFORM, not to judge or rate the owner's food choices. Present information neutrally and helpfully.

NUTRITIONAL SCIENCE:
- Carbs ferment into acids within minutes, dropping oral pH below 5.5 (enamel demineralization threshold)
- Each meal = one acid attack. Free feeding = continuous acid exposure all day
- High-quality animal protein supports gum tissue via collagen precursors
- Soft/glycerin-containing treats coat teeth and feed bacteria directly
- Sodium hexametaphosphate (HMP) chelates calcium preventing calculus — VOHC mechanism
- Ascophyllum nodosum (seaweed kelp) has VOHC acceptance for plaque/tartar reduction
- Small breeds: every dietary factor is amplified due to tooth crowding

FORMAT-SPECIFIC GUIDANCE (use this to write format_callout and format_risk_flags):

DRY KIBBLE:
  format_callout: Explain that kibble provides some mechanical abrasion during chewing which can slow plaque accumulation, but note that many dogs swallow kibble with minimal chewing so the benefit varies. Mention that VOHC-approved dental kibbles (like Hill's t/d, Purina DH, Royal Canin Dental) have been clinically tested and are worth considering if the current food isn't already dental-specific. Tailor to dental stage — if GREEN/YELLOW: encouraging. If ORANGE/RED: note kibble alone won't address existing disease, professional cleaning is needed.
  format_risk_flags: Return empty string "" — no significant flags for standard dry kibble.

WET/CANNED FOOD:
  format_callout: Explain that wet food is soft and provides very little mechanical cleaning action, which means plaque can build up more quickly. This doesn't make it a bad choice — many dogs do well on wet food — but it does mean that daily brushing and/or dental chews become especially important to compensate. If ORANGE/RED: be clear that wet food combined with the current dental picture makes home care even more critical, and a professional cleaning conversation with their vet is a priority.
  format_risk_flags: Return empty string "" — the callout covers the key points adequately.

RAW DIET:
  format_callout: Acknowledge that many raw-fed dogs do benefit from the chewing action involved, which can help with surface plaque. The key is that the benefit comes from the chewing, not the raw aspect itself. Note that some raw-fed dogs still accumulate significant tartar, so dental photos like these are a great way to check. Mention that nutritional completeness matters — a vet or veterinary nutritionist can help confirm the diet is balanced, which matters for gum tissue health and healing.
  format_risk_flags: Note that hard raw bones carry a real risk of tooth fractures (slab fractures of the carnassial tooth are one of the most common dental injuries seen in dogs). If the dental results show any structural damage, make this connection explicitly but gently. Also note that the AAHA and AVMA advise caution with raw diets due to bacterial contamination risks for both dogs and their humans.

FREEZE-DRIED:
  format_callout: Explain that freeze-dried food, once rehydrated, behaves much like wet food from a dental standpoint — soft texture, minimal mechanical cleaning action. If fed dry and crunchy, there's a small abrasive benefit, but pieces are typically too small to make a meaningful difference on the back teeth. So from a dental perspective, it's worth thinking of it similarly to wet food and making sure daily brushing or dental chews are part of the routine. Many freeze-dried diets are raw-based — worth checking with a vet that the formulation is nutritionally complete.
  format_risk_flags: Mention that freeze-dried diets vary widely in nutritional completeness. If the diet isn't AAFCO-compliant, deficiencies can affect gum tissue health over time and slow healing after any dental procedures.

HOME COOKED:
  format_callout: Acknowledge that home cooking comes from a place of real care for the dog, which is wonderful. From a dental standpoint, home-cooked food tends to be soft, so it provides little mechanical cleaning — similar to wet food. That means daily brushing becomes especially valuable. The bigger picture though is nutritional completeness: most home-prepared diets, even carefully made ones, are missing key nutrients that affect gum health and healing. A referral to a board-certified veterinary nutritionist (or a service like BalanceIT) to formulate a balanced recipe is genuinely one of the most helpful things an owner can do.
  format_risk_flags: Deficiencies in vitamins A, D, E, and B-complex (especially folic acid) are associated with worsened gum disease and impaired healing after dental procedures. Calcium/phosphorus imbalance can affect tooth and bone integrity over time. If the dental results show gum disease (gingival score 2+), make this connection gently but clearly.

MIXED KIBBLE AND WET:
  format_callout: Explain that with a mixed diet, the dental picture is somewhere between the two formats. The kibble portion provides some mechanical cleaning benefit, while the wet portion adds palatability and moisture. The balance matters — if wet food makes up most of the bowl, it tips toward the wet food picture. Either way, it's worth considering a VOHC dental chew as a daily complement since the mixed texture means mechanical cleaning is variable. Tailor to dental stage.
  format_risk_flags: Return empty string "" — the callout covers this adequately.

PRESCRIPTION DIET:
  format_callout: Note that prescription diets are formulated for a specific health purpose, so this context matters. If it's a dental prescription diet (like Hill's t/d), that's a genuine asset — these have VOHC acceptance and clinically tested texture. If it's for another condition (kidney, GI, weight, etc.), the dental impact depends on whether it's kibble or wet format. Either way, the vet who prescribed it is the right person to loop in about dental home care that works alongside it.
  format_risk_flags: Return empty string "" — the clinical context varies too much to flag generically.

RESPONSE FIELDS:

diet_assessment: 2–3 sentence neutral overview of how this dog's overall dietary picture (food + treats + home care) relates to their dental health. No scores, no verdicts. Warm and informative. Use the dog's name.

diet_mechanism: 1–2 sentences explaining HOW this specific food format physically interacts with the teeth. Factual, neutral, conversational. e.g. "Dry kibble creates some mechanical abrasion as [name] chews, which can help slow plaque accumulation on the tooth surfaces — though most of the real dental work still happens with brushing."

format_callout: The "what to keep in mind" paragraph for this specific diet type. Use the guidance above. Tailored to the dog's dental disease stage from the dental results. Warm and informative — not a verdict. 3–5 sentences. Use the dog's name.

format_risk_flags: ONLY populate when there is a genuine format-specific concern worth surfacing (see guidance above). Return empty string "" when no meaningful flags apply. When populated, 2–3 sentences maximum. Plain language, not alarmist.

treat_analysis: Assess the treats described. Explain the mechanism of any concern. Mention VOHC dental chews if not already in use. Use the dog's name.

oral_ph_impact: 2–3 sentences on the science of how this dog's diet (format + frequency + treats) affects oral pH and bacterial activity. Make it feel like an insight, not a lecture.

primary_recommendation: The single most important thing this owner should focus on given the dental results AND the diet picture. One sentence. Actionable. Warm. Uses the dog's name.

food_recommendations: Array of 2–4 specific suggestions. Each has: category (string), recommendation (string using dog's name), priority ("high"/"medium"/"low"), vohc_approved (boolean — true only for dental chews/diets with actual VOHC acceptance), mechanism (1 sentence explaining why).

ingredients_to_seek: Array of 4–6 specific ingredients or product features worth looking for on labels. Concrete, not generic.

ingredients_to_avoid: Array of 3–5 specific ingredients worth reducing. Concrete, not generic.

home_care_tips: Array of 3–4 practical home care suggestions. Specific, actionable, warm. Use the dog's name.

action_plan_intro: 1 sentence intro to the action plan. Warm. Uses the dog's name.

action_plan: { day_30: "", day_60: "", day_90: "" } — realistic, specific steps calibrated to dental severity.

recheck_days: Integer. GREEN=90, YELLOW=60, ORANGE=45, RED=30.

positive_note: 1 sentence of genuine encouragement. Uses the dog's name. Not generic.

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

// ── FALLBACK NUTRITION ─────────────────────────────────────────────────────
// CHANGED: Removed ohds_score, estimated_carb_pct, diet_oral_health_rating.
// CHANGED: Added format_callout and format_risk_flags with sensible defaults.
function fallbackNutrition(dogName, dietType) {
  return {
    diet_assessment: `We weren't able to complete the full nutritional analysis for ${dogName} this time, but the dental scores above still give you a useful picture.`,
    diet_mechanism: `The type of food ${dogName} eats has a direct effect on their teeth. Carbohydrates are fermented by oral bacteria into acids within minutes of eating — and those acids are what drive plaque and tartar formation.`,
    format_callout: `Every food format has its own relationship with dental health — the key is knowing what to pair with it. For ${dogName}, daily toothbrushing is the single most impactful thing you can add, regardless of what they're eating.`,
    format_risk_flags: "",
    treat_analysis: `Treats are often the hidden factor in oral health. Even a great main diet can be undermined by soft or sugary treats given regularly.`,
    oral_ph_impact: `When oral pH drops below 5.5, enamel starts to demineralise. Diet is the biggest driver of how often that happens — both the food format and how frequently ${dogName} eats matter.`,
    primary_recommendation: `A conversation with your vet about ${dogName}'s dental home care at the next check-up would be really worthwhile.`,
    food_recommendations: [
      {
        category: "Dental chews",
        recommendation: `If ${dogName} isn't already getting a daily dental chew, it might be worth looking into VOHC-accepted options — they've been independently tested and shown to actually reduce plaque or tartar.`,
        priority: "medium",
        vohc_approved: true,
        mechanism: "The VOHC seal means independent clinical testing confirmed the product works as claimed."
      }
    ],
    ingredients_to_seek: ["sodium hexametaphosphate (HMP)", "Ascophyllum nodosum (seaweed)", "zinc compounds", "high-quality named animal protein"],
    ingredients_to_avoid: ["corn syrup or molasses", "glycerin as primary ingredient", "carrageenan"],
    home_care_tips: [
      `Even brushing ${dogName}'s teeth a few times a week with enzymatic toothpaste can make a real difference.`,
      `A water additive with VOHC acceptance is an easy, low-effort addition to ${dogName}'s routine.`
    ],
    action_plan_intro: `Here's a gentle suggested path forward for ${dogName}.`,
    action_plan: {
      day_30: "Review treat types and frequency — soft or sugary treats are worth swapping out first",
      day_60: "Consider discussing dental diet or chew options with your vet",
      day_90: "Rescan with NOBL Dental Tracker to track how things are progressing"
    },
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

  // ── MODE: dental ──────────────────────────────────────────────────────────
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

  // ── MODE: nutrition ───────────────────────────────────────────────────────
  if (mode === "nutrition") {
    const { dentalResults } = body;
    if (!dentalResults) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing dentalResults for nutrition mode" }) };

    console.log("NUTRITION MODE:", breed, age + "yrs, diet:", dietType);

    // CHANGED: Removed OHDS score calculation context from prompt.
    // CHANGED: Added format_callout and format_risk_flags to the JSON schema.
    // CHANGED: Increased max_tokens to 1600 to accommodate the new fields.
    const nutritionPrompt =
`DOG NAME: ${dogName}
BREED: ${breed} | AGE: ${age}yrs | SEX: ${sex}${weight ? " | " + weight + "lbs" : ""}
FLAGS: ${flags.length > 0 ? flags.join("; ") : "none"}
DENTAL FINDINGS: Overall risk ${dentalResults.overall_risk}, composite ${dentalResults.composite_score}/9
Tartar: ${dentalResults.tartar?.composite}/3, Gums: ${dentalResults.gingival?.composite}/3, Structure: ${dentalResults.structural?.score}/3
Key findings: ${(dentalResults.key_findings || []).join("; ")}

DIET: ${currentFood} (${dietType}) | Est. carbs: ~${dietData.carb_pct}% | Fermentation: ${dietData.fermentation} | Moisture: ~${dietData.moisture}%
Protein source: ${proteinSource || "unknown"}
Feeding schedule: ${feedingSchedule || "unknown"}
Treats: ${treats || "none"} | Frequency: ${treatFrequency || "unknown"}
Home care: ${homeCare || "none"}
Body condition: ${bodyCondition || "unknown"}
Last cleaning: ${lastCleaning || "unknown"}
Symptoms: ${symptoms?.length > 0 ? symptoms.join(", ") : "none"}

Write the nutrition analysis in the warm veterinary friend tone. Use ${dogName}'s name throughout. The goal is to inform, not to judge food choices.

Return JSON:
{"diet_assessment":"","diet_mechanism":"","format_callout":"","format_risk_flags":"","treat_analysis":"","oral_ph_impact":"","primary_recommendation":"","food_recommendations":[{"category":"","recommendation":"","priority":"medium","vohc_approved":false,"mechanism":""}],"ingredients_to_seek":[""],"ingredients_to_avoid":[""],"home_care_tips":[""],"action_plan_intro":"","action_plan":{"day_30":"","day_60":"","day_90":""},"recheck_days":60,"positive_note":""}`;

    let nutrition = fallbackNutrition(dogName, dietType);
    try {
      const text = await callClaude(NUTRITION_SYSTEM_PROMPT, [{ role: "user", content: nutritionPrompt }], 1600);
      nutrition = extractJSON(text);
      console.log("Nutrition OK");
    } catch(e) { console.error("Nutrition error:", e.message); }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true, nutrition, meta: { mode: "nutrition", analyzedAt: new Date().toISOString(), dietData } }),
    };
  }

  return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid mode. Use 'dental' or 'nutrition'." }) };
};
