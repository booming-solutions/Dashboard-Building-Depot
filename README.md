# Booming Solutions — boomingsolutions.ai

CFO Services & AI Dashboards platform.

## Tech Stack
- **Next.js 14** — React framework
- **Supabase** — Database + authenticatie
- **Tailwind CSS** — Styling
- **Vercel** — Hosting
- **PWA** — Mobiele app

## Lokaal draaien

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Environment Variables

Maak een `.env.local` bestand aan met:

```
NEXT_PUBLIC_SUPABASE_URL=https://sxqtyviwcvokcejftwdq.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=jouw-key-hier
NEXT_PUBLIC_SITE_URL=https://boomingsolutions.ai
```

## Deployen naar Vercel

1. Push naar GitHub
2. Importeer in Vercel
3. Voeg environment variables toe
4. Koppel boomingsolutions.ai domein
