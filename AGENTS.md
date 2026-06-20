# Harvest Agent — Project Context

## What This Is
Harvest (theharvest.app) is a **multi-tenant ministry SaaS** platform. Churches/ministries sign up, get a subdomain (e.g. `gracechurch.theharvest.app`), and manage their community through an admin dashboard. End users access church content through a mobile-first web app.

## Tech Stack
- **Framework**: Next.js 14 (App Router) + React 18 + TypeScript
- **Styling**: Tailwind CSS 3 + Framer Motion (motion)
- **Backend**: Firebase (Firestore, Auth, Storage)
- **Payments**: Stripe (subscriptions + Stripe Connect for revenue sharing)
- **Email**: Resend
- **AI**: Xiaomi MiMo (mimo-v2.5) for RAG chat, kept Gemini for embeddings
- **Maps**: Leaflet + Google Places Autocomplete
- **Rich Text**: TipTap editor
- **Hosting**: Vercel (app) + Firebase (Firestore/Auth)

## Key Files & Structure

```
src/
├── app/
│   ├── page.tsx              # Entry point → loads App.tsx
│   ├── layout.tsx            # Root layout
│   └── api/
│       ├── ai-assistant/route.ts    # AI Assistant (Telegram bot)
│       ├── gemini/route.ts          # RAG chat endpoint (MiMo)
│       ├── stripe/                  # All Stripe endpoints
│       │   ├── checkout/route.ts    # Subscription checkout
│       │   ├── connect/route.ts     # Stripe Connect onboarding
│       │   ├── webhook/route.ts     # Stripe webhooks
│       │   ├── portal/route.ts      # Customer portal
│       │   ├── donate/route.ts      # Donations
│       │   └── ...
│       ├── auth/                    # Custom claims management
│       ├── send-email/route.ts      # Email sending
│       └── enterprise-lead/route.ts # Enterprise contact form
├── components/
│   ├── MainApp.tsx           # Main user-facing app shell (tabs: Home, Bible, Chat, Map, Profile)
│   ├── AdminDashboard.tsx    # Admin panel
│   ├── AdminBlog.tsx         # Blog management
│   ├── AdminCourses.tsx      # Course management
│   ├── AdminChurches.tsx     # Church management (Enterprise)
│   ├── AdminSettings.tsx     # Tenant settings
│   ├── AdminTenants.tsx      # Super admin tenant management
│   ├── AIChat.tsx            # AI chat interface
│   ├── AuthPage.tsx          # Login/signup
│   ├── Profile.tsx           # User profile
│   ├── BlogTab.tsx           # User blog view
│   ├── ChurchMap.tsx         # Church map (Enterprise)
│   ├── EnterpriseContactModal.tsx
│   ├── Onboarding.tsx        # Tenant onboarding flow
│   └── course/               # Course components
├── contexts/
│   └── TenantContext.tsx     # Tenant context provider
├── types/
│   ├── tenant.types.ts       # TenantPlan, TenantConfig, Tenant
│   └── course.types.ts       # Course types
├── utils/
│   ├── plan-features.ts      # Plan feature flags
│   ├── tenant.utils.ts       # Tenant helpers
│   ├── sanitize.ts           # XSS sanitization
│   └── email.ts              # Email templates
├── lib/
│   ├── firebase-admin.ts     # Server-side Firebase
│   └── api-auth.ts           # API authentication helpers
└── firebase.ts               # Client-side Firebase config
```

## Pricing Tiers (TenantPlan)
| Plan | Display Name | Price | Blog | AI | Map | Church Directory | Churches | Courses | Admins | Custom Domain | AI Assistant |
|------|-------------|-------|------|-----|-----|-----------------|----------|---------|--------|---------------|-------------|
| plus | Individual | $49/mo | ✅ | ❌ | ✅ (own) | ❌ | 1 | 5 | 2 | ❌ | ❌ |
| pro | Community | $99/mo | ✅ | ✅ | ✅ (own) | ❌ | 1 | ∞ | 5 | ❌ | ❌ |
| max | Church | $199/mo | ✅ | ✅ | ✅ (own) | ❌ | 1 | ∞ | ∞ | ✅ | ❌ |
| ultra | Ministry | $349/mo | ✅ | ✅ | ✅ (own) | ❌ | 1 | ∞ | ∞ | ✅ | ✅ |
| enterprise | Enterprise | custom | ✅ | ✅ | ✅ | ✅ (global discovery) | ∞ | ∞ | ∞ | ✅ | ✅ |

Map note: All plans show their own church location(s) on the map. The global multi-church discovery directory (browsing all tenants' churches) is Enterprise-only (`churchDirectory` feature flag).

## Revenue Sharing (Stripe Connect)
- Individual (plus): 85% to church
- Community (pro): 90% to church
- Church (max): 95% to church
- Ministry (ultra): 100% to church
- Enterprise: 100% to church

## Design System
- **Background**: White
- **Font**: Nunito
- **Accent**: Gold `#D4AF37`
- **Dark**: Navy `#0b1121`
- **Terminology**: "Ministries" NOT "churches" in user-facing copy
- **"AI Assistant"** = admin-only Telegram bot tool
- Plus/Pro plans have **NO custom branding**

## Firebase Project
- Project ID: `harvest-agent-233a1`
- Service account: `/root/.firebase/serviceAccountKey.json`
- Super admin: via `NEXT_PUBLIC_SUPER_ADMIN_EMAIL` env var

## Stripe (TEST MODE)
- Account: `acct_1TioBC1YKkcSbTf3`
- Products: Plus `prod_UiFqnOe6b0lhrP`, Pro `prod_UiFq52hfQcT8nT`, Ultra `prod_UiFqa2JkBvjtOt`
- Webhook: `we_1Tipih1YKkcSbTf3e76W3mut`
- Keys in Vercel env vars

## AI / RAG Chat
- Model: Xiaomi MiMo (mimo-v2.5) via Token Plan API
- Base URL: `token-plan-cn.xiaomimimo.com`
- Key prefix: `tp-`
- Gemini kept for embeddings only

## Deployment
- **App**: Vercel at `harvest-agent.vercel.app`
- **Presentation site**: Vercel at `harvest-site.vercel.app`
- **Domain**: theharvest.app (Namecheap, A→76.76.21.21, CNAME→vercel-dns.com)
- **Git author**: `bumbmatei@gmail.com` / `Matei`

## Important Rules
1. **NEVER modify Harvest-Site---STABLE** — it's the stable backup
2. Always set git config before committing: `git config --global user.email "bumbmatei@gmail.com" && git config --global user.name "Matei"`
3. `git config` defaults to root@vps which breaks Vercel deployments
4. Git PAT: `/tmp/git-askpass.sh` → set `GIT_ASKPASS=/tmp/git-askpass.sh`
5. **Churches as sub-entities**, not separate tenants (Enterprise)
6. Always verify which branch/version is deployed before editing
7. Run bug analysis after feature implementation (3+ files changed)

## Related Repos
- `Harvest-agent` — main app (this repo)
- `harvest-presentation-site` — marketing/landing page (HTML)
- `Harvest-Site---STABLE` — stable backup (DO NOT MODIFY)

## Current Status (as of last commits)
- Enterprise checkout flow with contact form + email notification
- Per-church announcements (admin CRUD + My Church 2-tab view)
- RAG chat switched from Gemini to MiMo
- Security hardening (tenant isolation, charge metadata, claims batching)
- 12 critical/high bugs fixed
- Phase 4: AI Assistant access codes + anti-sharing
