# Lehren Lieben.

Podcast-Webseite für *Lehren Lieben.* (Tobias Kammer & Alexander Böhle) — gebaut
mit **Astro 5**, **React 19** (nur für den Chat), **Tailwind v4** und auf
**Vercel** deployt.

## Entwicklung

```bash
npm install
npm run dev
```

Dev-Server läuft auf http://localhost:4321.

## Build

```bash
npm run build
```

Der Output landet in `dist/` (statisches HTML + Vercel-Serverless-Funktionen).

## Struktur

```
src/
  pages/
    index.astro         – Startseite, importiert alle Sections
    api/chat.ts         – Serverless-Endpoint für den Lehrkräftementor
  components/
    Nav.astro
    Hero.astro          – Uppercase "LEHREN / LIEBEN." + L-Logo links
    Podcasts.astro
    Episodes.astro      – Random-Episode-Button mit JS
    Mentor.astro        – wrappt React-Chat
    LehrkraftmentorChat.tsx
    Team.astro          – 2 Hosts (groß) + 2 weitere (klein)
    Community.astro
    GuestForm.astro
    Footer.astro
  layouts/Layout.astro  – HTML-Shell, Fonts, Nav-Scroll, Reveal
  styles/global.css     – Design-Tokens (@theme) + komponentenspezifisches CSS
  data/episodes.ts      – Episoden-Pool für Random-Auswahl
public/uploads/         – Hero-Foto, Host-Portraits, Logo
legacy/                 – Original-Prototyp (HTML standalone)
```

## Chat-Backend

Der Lehrkräftementor ruft `POST /api/chat` auf. Der Endpoint proxied zu
OpenAI (Model: `gpt-4o-mini`). Dafür muss in Vercel die Env-Variable gesetzt
sein:

```
OPENAI_API_KEY=sk-...
```

Ohne Key antwortet `/api/chat` mit `503` und der Chat zeigt eine freundliche
Fehlermeldung — die Seite bleibt funktional.

Lokal: `.env` anlegen (siehe `.env.example`). Lokaler Dev-Server gibt den Key
über `import.meta.env` an den Handler weiter.

## Deployment

1. Vercel-Projekt mit dem GitHub-Repo verbinden.
2. Env-Variable `OPENAI_API_KEY` in den Vercel-Projekteinstellungen hinterlegen.
3. Push auf `main` → Vercel baut automatisch.
