# Portal Meditatii Mate – Production Guide

## Table of Contents
1. [Architecture Decision](#architecture)
2. [Folder Structure](#folder-structure)
3. [Security Explained](#security)
4. [Database Schema](#database)
5. [Authentication](#authentication)
6. [Payment Flow](#payment-flow)
7. [Step-by-Step Deployment](#deployment)
8. [Migration from localStorage](#migration)
9. [Future Roadmap](#roadmap)

---

## 1. Architecture Decision {#architecture}

### What was chosen and why

**Stack: Supabase (PostgreSQL) + Netlify (static hosting)**

| Concern | Choice | Why |
|---------|--------|-----|
| Database | Supabase (PostgreSQL) | Free tier, built-in auth, REST API with zero backend code |
| Auth | Supabase Auth (email+password) | bcrypt hashing, session management, JWT – all built in |
| Hosting | Netlify (or Vercel) | Free tier, HTTPS automatic, deploys from Git in seconds |
| Backend code | None | Supabase's REST API + Row Level Security replaces a custom backend |
| Build tool | None (plain ES modules) | Keeps it simple; can add Vite later if needed |

### Why NOT a custom Node.js backend?
For a solo tutor with ~10-20 students, a custom Express/Node backend adds:
- A server to maintain and pay for
- Deployment complexity (Railway, Render, etc.)
- Security surface area you have to handle yourself

Supabase handles all of that for free, with better security defaults than most custom servers.

### Why NOT Firebase/Firestore?
- PostgreSQL is relational – perfect for students/slots/payments with foreign keys
- Supabase has proper RLS (Row Level Security) that's easy to reason about
- Supabase is open source; you can self-host if needed later

### Operating cost
- Supabase free tier: 500MB database, 5GB bandwidth, 50,000 MAUs → **€0/month**
- Netlify free tier: 100GB bandwidth, unlimited deploys → **€0/month**
- Total: **€0/month** for a tutoring business of this size

---

## 2. Folder Structure {#folder-structure}

```
portal-meditatii-mate/
├── index.html                  ← Entry point (modified from prototype)
├── styles.css                  ← Styles (original + additions)
├── .env.example                ← Template – copy to .env.local
├── .gitignore
├── netlify.toml                ← Netlify config + security headers
├── vercel.json                 ← Vercel alternative
│
├── src/
│   ├── app.js                  ← Main app logic (replaces old app.js)
│   ├── lib/
│   │   └── supabase.js         ← Supabase client singleton
│   └── modules/
│       ├── auth.js             ← Login / logout / session
│       ├── students.js         ← Students CRUD + phone lookup
│       ├── slots.js            ← Weekly schedule CRUD
│       ├── payments.js         ← Payment settings + payment records
│       └── validation.js       ← Input sanitisation + escapeHtml
│
└── supabase/
    └── migrations/
        └── 001_initial_schema.sql  ← Full DB schema with RLS
```

**Why split into modules?**
Each module has one job. If the payment flow changes, you only touch `payments.js`.
If validation logic needs updating, it's all in `validation.js`. No more hunting through
a 700-line file.

---

## 3. Security Explained {#security}

Every security decision is documented here so you understand the "why".

### 3.1 No more PIN in source code
**Old:** `const ADMIN_PIN = "1234"` – visible to anyone who views source.
**New:** Supabase Auth uses bcrypt-hashed passwords stored in their database.
Your password never appears in code.

### 3.2 Row Level Security (RLS)
Supabase's RLS is like a firewall built into the database itself.
Even if someone gets your anon API key (it's public by design), they can only
do what RLS allows:

| Table | Anonymous (parents) | Authenticated (you) |
|-------|--------------------|--------------------|
| payment_settings | SELECT only | Full access |
| students | SELECT only (no notes) | Full access |
| slots | SELECT only | Full access |
| payments | INSERT (pending only) | Full access |

This means: even if a hacker has your anon key, they **cannot** read payment history,
delete students, or change settings.

### 3.3 Input validation at two layers
**Layer 1 – JavaScript (validation.js):** Trims, checks length, validates phone format.
Gives the user instant error messages without a network round-trip.

**Layer 2 – PostgreSQL constraints:** `CHECK` constraints on `status`, `method`, `day`
columns. Even if someone bypasses the JS validation (e.g. via the API directly),
the database rejects invalid data.

### 3.4 SQL injection is impossible
Supabase uses parameterised queries under the hood. You never concatenate user input
into SQL strings. This is the main SQL injection attack vector, and it doesn't exist here.

### 3.5 XSS prevention
Every piece of user data displayed in HTML goes through `escapeHtml()` in `validation.js`.
This converts `<`, `>`, `"`, `'`, `&` into HTML entities, so a student named
`<script>alert(1)</script>` renders as text, not executable code.

### 3.6 Rate limiting
**What's in place:** The parent lookup button is disabled for 800ms after each click.
This prevents rapid-fire requests.

**For production, add Supabase rate limiting** (in their dashboard under Auth settings):
- Set "Rate limit email sending" to prevent abuse
- Their REST API has built-in rate limiting at the platform level

**If you want more:** Netlify and Vercel both offer rate limiting via their Edge
Functions or third-party services like Upstash.

### 3.7 HTTPS
Both Netlify and Vercel provide automatic HTTPS with Let's Encrypt certificates.
The `Strict-Transport-Security` header in `netlify.toml` tells browsers to always
use HTTPS for your domain, even if someone tries to access it via HTTP.

### 3.8 Environment variables
The Supabase URL and anon key are injected into the page via `window.__ENV`.
**These are public values** – the anon key is designed to be public; it's not a secret.
Security comes from RLS policies, not from hiding the key.

What you **never** put in the frontend:
- Your Supabase `service_role` key (bypasses RLS – server-side only)
- Any payment processor secret keys
- Admin email/password

### 3.9 Content Security Policy
The `netlify.toml` sets a CSP header that:
- Only allows scripts from your own domain and the Supabase JS CDN
- Prevents loading scripts from arbitrary external domains
- Blocks your site from being embedded in iframes (clickjacking protection)

---

## 4. Database Schema {#database}

See `supabase/migrations/001_initial_schema.sql` for the full schema with comments.

### Tables at a glance

**payment_settings** – single row, the tutor's payment details
```
id (always 1) | iban | revolut | bt_pay | price_per_hour | updated_at
```

**students** – active students (soft-deleted, never hard-deleted)
```
id (uuid) | student_name | parent_name | phone (unique) | notes | deleted_at | created_at
```

**slots** – the weekly recurring schedule (Mon-Fri, 13:00-21:00)
```
id (uuid) | day | time | status (free/booked) | student_id (FK) | updated_at
```

**payments** – every payment record ever (audit log)
```
id (uuid) | student_id (FK) | hours | amount_lei | method | status | notes | created_at
```

### Why soft deletion for students?
If you delete a student who has payment records, you'd lose the link between
payments and who they belong to. Soft deletion (setting `deleted_at`) preserves history.
The student won't appear in lookups or the admin list, but their payment history is intact.

---

## 5. Authentication {#authentication}

### How it works
1. You (admin) go to the Admin tab
2. Enter your email + password
3. Supabase verifies the password hash, returns a JWT session token
4. The session is stored in localStorage by the Supabase SDK
5. Every API call includes the JWT; Supabase checks `auth.role() = 'authenticated'`
6. The session auto-refreshes; you stay logged in

### Setting up your admin account
You create your account once in the Supabase dashboard (see Deployment section).
You never hard-code credentials anywhere.

### Why parents don't need accounts
Creating parent accounts adds friction (email verification, forgotten passwords,
support requests) for a small tutoring business where you already know every parent.
Phone-number lookup is simpler and secure enough: the phone number acts as a read-only
access token. Parents can only see their own student's schedule, not anyone else's.

### Session security
- JWT tokens expire after 1 hour by default; Supabase auto-refreshes them
- Logging out clears the token from localStorage
- If you suspect compromise, go to Supabase → Auth → Users → Revoke sessions

---

## 6. Payment Flow {#payment-flow}

### Current implementation: Manual confirmation
The current flow is intentionally simple and safe:
1. Parent selects hours, clicks "Am efectuat plata" (I made the payment)
2. A `pending` payment record is created in the database
3. You see it in the Admin → Plati panel with a "Confirma" button
4. After you verify the transfer in your banking app, you click "Confirma"

**Why this is the right choice for now:**
- Zero integration complexity
- Zero transaction fees
- You already verify payments manually anyway
- No PCI DSS compliance burden
- Works with Romanian banks (Revolut, BT Pay, regular transfer)

### Adding Stripe later (optional)
If you want automatic payment confirmation in the future:

1. Create a Stripe account at stripe.com
2. Add `VITE_STRIPE_PUBLISHABLE_KEY` to your environment variables
3. Create a Supabase Edge Function (serverless, free tier) to handle the webhook
4. The Edge Function uses the `STRIPE_SECRET_KEY` (server-side only, never in frontend)

This is a 1-2 day project when you're ready. The database schema already has the
`payments` table ready to support it.

---

## 7. Step-by-Step Deployment {#deployment}

### Prerequisites
- A GitHub account (free)
- A Supabase account (free) at supabase.com
- A Netlify account (free) at netlify.com

---

### Step 1: Set up Supabase

1. Go to https://supabase.com → New project
2. Choose a name (e.g. "portal-meditatii"), region closest to you (eu-central-1), and a strong database password. **Save the database password somewhere safe.**
3. Wait ~2 minutes for the project to spin up.

**Run the database migration:**
4. In Supabase, go to: SQL Editor (left sidebar)
5. Click "New query"
6. Copy the entire contents of `supabase/migrations/001_initial_schema.sql`
7. Paste it and click "Run"
8. You should see "Success. No rows returned"

**Create your admin account:**
9. In Supabase, go to: Authentication → Users
10. Click "Add user" → "Create new user"
11. Enter your email and a strong password (use a password manager!)
12. Click "Create user"

**Get your API credentials:**
13. In Supabase, go to: Project Settings → API
14. Copy:
    - **Project URL** (looks like `https://xxxxxxxxxxxx.supabase.co`)
    - **Project API keys → anon public** (long string starting with `eyJ...`)

---

### Step 2: Configure the app

**Open `index.html`** and find this block near the top:
```html
<script>
  window.__ENV = {
    SUPABASE_URL:      "REPLACE_WITH_YOUR_SUPABASE_URL",
    SUPABASE_ANON_KEY: "REPLACE_WITH_YOUR_SUPABASE_ANON_KEY"
  };
</script>
```

Replace the placeholder strings with your actual values from Step 1.
Example:
```html
<script>
  window.__ENV = {
    SUPABASE_URL:      "https://abcdefghij.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  };
</script>
```

**These values are safe to commit to git.** The anon key is public by design.

---

### Step 3: Push to GitHub

```bash
# In the project folder
git init
git add .
git commit -m "Initial production version"

# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/portal-meditatii-mate.git
git push -u origin main
```

---

### Step 4: Deploy on Netlify

1. Go to https://netlify.com → "Add new site" → "Import an existing project"
2. Connect to GitHub, select your repository
3. Build settings:
   - **Build command:** (leave empty – no build step)
   - **Publish directory:** `.` (dot, meaning the root)
4. Click "Deploy site"
5. After ~30 seconds, your site is live at a random URL like `amazing-banach-123.netlify.app`

**Custom domain (optional):**
6. In Netlify: Domain settings → Add custom domain
7. Follow their instructions to update your DNS

---

### Step 5: Configure Supabase auth URL

Tell Supabase which URLs are allowed to handle auth redirects:
1. In Supabase: Authentication → URL Configuration
2. Set **Site URL** to your Netlify URL (e.g. `https://amazing-banach-123.netlify.app`)
3. Add your custom domain too if you have one

---

### Step 6: Test everything

- [ ] Open the site → Calendar loads with empty slots
- [ ] Admin tab → Login with your email/password
- [ ] Add a student
- [ ] Assign them to a slot
- [ ] Check the calendar updates
- [ ] Parent portal → search by the student's phone
- [ ] Go through the payment flow
- [ ] Admin → Payments → confirm the test payment
- [ ] Logout → verify admin panel is locked

---

### Vercel alternative

If you prefer Vercel:
1. Go to https://vercel.com → New Project → Import Git Repository
2. Same settings (no build command, root as output)
3. The `vercel.json` file handles routing and security headers automatically

---

## 8. Migration from localStorage {#migration}

Your old prototype stored data in the browser's localStorage.
That data is only on the device where you used it.

**To migrate existing students:**
1. Open your OLD site in a browser
2. Open DevTools (F12) → Console
3. Run: `console.log(JSON.stringify(JSON.parse(localStorage.getItem('portal-meditatii-mate-v2'))))`
4. Copy the output
5. In your new admin panel, add each student manually
   (there's no bulk import yet, but you likely have <20 students)

**To migrate slot configuration:**
The new system seeds all slots as "free" by default.
After logging into the new admin, set up your slot assignments in the Admin → Orar section.

---

## 9. Future Roadmap {#roadmap}

These are improvements to consider once the app is live and stable,
roughly in priority order.

### Short term (1-4 weeks)
- [ ] **Email notifications:** When a parent records a payment, send yourself an email.
      Supabase has built-in email via Edge Functions. Takes ~2 hours.
- [ ] **Attendance tracking:** Add an `attendance` table and a simple check-in button
      in the admin panel.
- [ ] **Export to PDF/CSV:** Monthly payment summaries for accounting.

### Medium term (1-3 months)
- [ ] **Stripe integration:** Automatic payment confirmation.
      Only worth doing if manual confirmation becomes a bottleneck.
- [ ] **Student portal login:** If you want parents to have real accounts with history.
      Supabase Auth supports magic links (email → no password needed).

### Long term
- [ ] **Vite build process:** Bundle and minify JS for better performance.
      Simple to add: `npm init vite`, move files, update imports.
- [ ] **Multiple tutors:** The current schema supports it with a `tutor_id` column.
- [ ] **Recurring payment reminders:** Automated WhatsApp/email before payment is due.

---

## Troubleshooting

**"Missing Supabase credentials" error on load**
→ Check that `window.__ENV` in `index.html` has the correct URL and anon key.

**Admin login says "Email sau parola incorecte"**
→ Verify the user exists in Supabase → Authentication → Users.
→ Try the "Send reset password email" option to reset.

**Phone lookup doesn't find a student**
→ Check the phone format in the admin. Try with and without country code.
→ The system normalises 07xx and +407xx formats automatically.

**Changes in admin don't appear on the calendar**
→ Click "Salveaza toate orele" after making slot changes.

**Supabase returns "row violates row-level security policy"**
→ You're not logged in as admin. The session may have expired – log out and back in.
