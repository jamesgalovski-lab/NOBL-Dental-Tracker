# DentalPaw — Canine Dental Screening App

AI-powered canine dental screening and nutrition recommendations.  
Built on: GitHub + Netlify + Uploadcare + Cloudflare + Anthropic Claude API

---

## STEP-BY-STEP DEPLOYMENT GUIDE

---

### STEP 1 — Get Your API Keys

You need two keys before anything else.

**A. Anthropic API Key**
1. Go to https://console.anthropic.com
2. Sign in / create account
3. Click "API Keys" in the left nav
4. Click "Create Key" → name it `dentalpaw-prod`
5. Copy the key (starts with `sk-ant-api03-...`) — save it somewhere safe

**B. Uploadcare Public Key**
1. Go to https://app.uploadcare.com
2. Sign in / create account
3. Click "Create new project"
4. Name it `dentalpaw` → choose "Built-in storage"
5. Go to API Keys tab → copy your **Public Key** (not Secret Key)

---

### STEP 2 — Set Up Your Local Project

```bash
# Clone or create your repo
mkdir dentalpaw && cd dentalpaw

# Copy all the files from this package into this folder
# Your structure should look like:
# dentalpaw/
# ├── netlify.toml
# ├── package.json
# ├── .env.example
# ├── .gitignore
# ├── netlify/
# │   └── functions/
# │       └── analyze.js
# └── public/
#     └── index.html

# Install dependencies
npm install
```

---

### STEP 3 — Configure Your Keys

**A. Add your Uploadcare key to the HTML**

Open `public/index.html` and find line:
```javascript
uploadcarePublicKey: 'YOUR_UPLOADCARE_PUBLIC_KEY',
```
Replace `YOUR_UPLOADCARE_PUBLIC_KEY` with your actual Uploadcare public key.

**B. Create your local .env file**

```bash
cp .env.example .env
```

Edit `.env`:
```
ANTHROPIC_API_KEY=sk-ant-api03-your-actual-key-here
UPLOADCARE_PUBLIC_KEY=your-uploadcare-public-key-here
```

---

### STEP 4 — Push to GitHub

```bash
# Initialize git (if not already)
git init
git add .
git commit -m "Initial DentalPaw V1"

# Create a new repo on github.com (call it dentalpaw or similar)
# Then connect and push:
git remote add origin https://github.com/YOUR_USERNAME/dentalpaw.git
git branch -M main
git push -u origin main
```

---

### STEP 5 — Deploy to Netlify

1. Go to https://app.netlify.com
2. Click **"Add new site"** → **"Import an existing project"**
3. Choose **GitHub** → authorize → select your `dentalpaw` repo
4. Build settings:
   - **Branch:** main
   - **Build command:** *(leave empty)*
   - **Publish directory:** `public`
5. Click **"Deploy site"**

**Add your environment variables:**
1. Go to **Site Settings** → **Environment variables**
2. Add:
   - Key: `ANTHROPIC_API_KEY` → Value: your Anthropic key
   - Key: `UPLOADCARE_PUBLIC_KEY` → Value: your Uploadcare public key
3. Click **"Trigger deploy"** → **"Deploy site"** to redeploy with the variables

---

### STEP 6 — Connect Your Domain via Cloudflare

**A. In Netlify:**
1. Go to **Site Settings** → **Domain management**
2. Click **"Add custom domain"**
3. Enter your domain (e.g. `dentalpaw.com` or `dental.yourdomain.com`)
4. Netlify will show you DNS records to add

**B. In Cloudflare:**
1. Go to your domain in Cloudflare dashboard
2. Click **DNS** → **Add record**
3. Add the CNAME record Netlify provided:
   - Type: `CNAME`
   - Name: `@` (or subdomain like `dental`)
   - Target: your Netlify site URL (e.g. `dentalpaw.netlify.app`)
   - Proxy: ON (orange cloud) ✓
4. Netlify will automatically provision SSL via Let's Encrypt

---

### STEP 7 — Test Your Deployment

1. Visit your Netlify URL (e.g. `https://dentalpaw.netlify.app`)
2. Fill in dog profile — use a test dog
3. Upload two test photos of a dog's teeth (or any dog photo to test the flow)
4. Click "Analyse My Dog's Teeth"
5. Check Netlify function logs: **Functions** tab → **analyze** → view invocations

**Test the API directly:**
```bash
curl -X POST https://YOUR-SITE.netlify.app/.netlify/functions/analyze \
  -H "Content-Type: application/json" \
  -d '{"dogProfile":{"breed":"Labrador","age":4,"sex":"Male (neutered)","currentFood":"Royal Canin","dietType":"dry kibble","treats":"none","homeCare":"none","bodyCondition":"ideal weight","lastCleaning":"never","symptoms":[]},"images":{"rightUrl":"https://ucarecdn.com/REAL-UUID-HERE/"}}'
```

---

### STEP 8 — Uploadcare Configuration (Optional but Recommended)

In your Uploadcare dashboard:
1. **File types:** Restrict to images only (JPEG, PNG, WEBP, HEIC)
2. **Max file size:** Set to 10MB
3. **Transformations:** Enable auto image optimization
4. **CORS:** Add your domain to allowed origins

---

## FILE STRUCTURE EXPLAINED

```
dentalpaw/
├── netlify.toml              # Tells Netlify where files are + security headers
├── package.json              # Node dependencies (Anthropic SDK)
├── .env.example              # Template for environment variables
├── .gitignore                # Prevents secrets from being committed
├── netlify/
│   └── functions/
│       └── analyze.js        # THE BRAIN — calls Claude API, returns analysis
└── public/
    └── index.html            # THE APP — complete UI, upload logic, results
```

---

## HOW IT WORKS (Data Flow)

```
User fills form → Uploads photos to Uploadcare (direct, no server) →
Uploadcare returns CDN URLs → User clicks Analyse →
Browser sends dog profile + image URLs to Netlify Function →
Netlify Function calls Claude API with images + context →
Claude returns dental scores + nutrition JSON →
Netlify Function returns combined result to browser →
Browser renders results screen
```

---

## ONGOING MAINTENANCE

**Update the Anthropic model:**
In `netlify/functions/analyze.js`, find `claude-sonnet-4-6` and update as newer models release.

**Monitor costs:**
- Anthropic Console → Usage → track tokens per analysis
- Typical cost per analysis: ~$0.01-0.03 depending on image sizes and output length

**View logs:**
- Netlify Dashboard → Functions → analyze → Recent invocations

---

## FUTURE V2 ADDITIONS

- [ ] Email results via Netlify Forms + Zapier
- [ ] Save history with Supabase (free tier)
- [ ] Longitudinal trend tracking
- [ ] Push notification reminders (convert to PWA)
- [ ] Vet referral integration
- [ ] Breed auto-complete from AKC database
