# Datenbasis des Lehrkraftmentors aus DOCX-Transkripten bauen

> Quelle der Wissensbasis: **aufbereitete DOCX-Transkripte** (vom Team geliefert),
> NICHT die Podigee-RSS-Transkripte. Das aktuelle `scripts/build-corpus.ts` zieht noch
> aus Podigee und wird in der nächsten Session auf DOCX umgestellt (siehe Prompt unten).
>
> Status beim Speichern (2026-06-21): Backend + Website + Tageslimit sind live.
> Offen: (a) `OPENAI_API_KEY` in Vercel setzen (Laufzeit-Embedding der Frage),
> (b) `mentor-api/corpus.json` aus den DOCX bauen, (c) finalen Prompt in
> `mentor-api/prompt.ts` einsetzen.

## Plan

**Ziel:** Aus den DOCX wird `mentor-api/corpus.json` — die Datei, aus der die Funktion
zur Laufzeit die passenden Stellen sucht. Pipeline: DOCX-Text extrahieren → in Häppchen
zerlegen → per OpenAI embedden → `corpus.json`. (Häppchen/Embeddings/Funktion bleiben
identisch zur bisherigen Planung; nur der „Einlese"-Teil wechselt von RSS auf DOCX.)

1. **Ablage & Benennung:** Ordner `transcripts/` im Projekt-Root; alle DOCX dort.
   Für saubere Zitate Dateien benennen nach (Trenner = doppelter Unterstrich):
   ```
   <Show>__<Folge>__<Titel>.docx
   z. B.  Bester Job der Welt__#17__Ferien-Talk Rebellentreff.docx
          Ausgezeichnete Lehrkräfte__#5__Monika Ried-Broschwitz.docx
   ```
   Ohne dieses Schema: Dateiname (ohne Endung) = Titel, `show`/`ep` leer.

2. **Build-Skript:** DOCX-Text via `mammoth` extrahieren → ~1.800-Zeichen-Häppchen mit
   ~200 Überlappung → OpenAI-Embeddings → `mentor-api/corpus.json`.
   **Kritisch:** Embedding-Modell + `dimensions` MÜSSEN exakt zu `mentor-api/lib/rag.ts`
   passen (`text-embedding-3-small`, `dimensions: 512`), sonst findet die Laufzeit-Suche
   nichts. Hash-Cache (`scripts/.embed-cache.json`) → beim Nachliefern nur Neues embedden.

3. **Bauen (lokal):** `OPENAI_API_KEY` in `.env` (Projekt-Root), dann `npm run build:corpus`.

4. **Live schalten:** `OPENAI_API_KEY` **auch in Vercel** setzen (Laufzeit) →
   `git add mentor-api/corpus.json && git commit && git push` → Vercel deployt → RAG aktiv.

5. **Nachliefern:** neue DOCX in `transcripts/`, Schritt 3 + 4 wiederholen.

> Die DOCX werden NICHT zu Vercel deployt — nur `corpus.json`.

## Prompt für Claude Code (in der neuen Session nutzen)

Wenn die DOCX in `transcripts/` liegen, diesen Prompt in Claude Code (in diesem Repo) paste:

```
Im Repo dieser Astro-Seite gibt es eine RAG-Chat-Funktion unter `mentor-api/`.
Ich habe Podcast-Transkripte als DOCX-Dateien im Ordner `transcripts/` abgelegt.
Baue daraus die Vektor-„Datenbank" `mentor-api/corpus.json`.

Vorgaben:
1. Lies ZUERST `mentor-api/lib/rag.ts` und `mentor-api/api/chat.ts` und übernimm
   daraus die exakte Chunk-Datenstruktur und die Embedding-Parameter. Das
   Embedding-Modell und die `dimensions` im Build-Skript MÜSSEN identisch zu
   `rag.ts` sein (aktuell `text-embedding-3-small`, `dimensions: 512`) — sonst
   passt die Suche zur Laufzeit nicht.
2. Installiere `mammoth` für die DOCX-Textextraktion: `npm install -D mammoth`.
3. Ersetze `scripts/build-corpus.ts` durch eine Version, die:
   - alle `*.docx` aus `transcripts/` einliest (mammoth, raw text),
   - Metadaten aus dem Dateinamen nach dem Schema `<Show>__<Folge>__<Titel>.docx`
     ableitet (Trenner `__`); fehlt das Schema, nutze den Dateinamen ohne Endung
     als Titel und lass `show`/`ep` leer,
   - den Text in Häppchen von ~1800 Zeichen mit ~200 Zeichen Überlappung an
     Satzgrenzen zerlegt,
   - jedes Häppchen per OpenAI embeddet (Modell/dims wie oben), mit einem
     Inhalts-Hash-Cache in `scripts/.embed-cache.json` (nur Neues neu embedden),
   - `mentor-api/corpus.json` als JSON-Array mit GENAU den Feldern des `Chunk`-Typs
     aus `rag.ts` schreibt (`text`, `episodeTitle`, `show`, `ep`, `url`, `embedding`);
     `url` darf leer bleiben,
   - `OPENAI_API_KEY` aus der Umgebung liest. Das npm-Skript `build:corpus` ruft
     bereits `node --env-file=.env --experimental-strip-types scripts/build-corpus.ts`
     auf — nutze das. Brich mit klarer Meldung ab, wenn der Key fehlt.
4. Führe `npm run build:corpus` aus (`OPENAI_API_KEY` liegt in `.env` im Root).
   Verifiziere danach: corpus.json ist valides JSON, nicht leer, jedes Element hat
   ein `embedding`-Array der Länge 512, Metadaten stimmen. Gib eine kurze
   Zusammenfassung aus (Anzahl Dateien, Anzahl Häppchen).
5. Committe und deploye NOCH NICHTS — zeig mir zuerst das Ergebnis.
```

## Danach (finaler Mentor-Prompt)

Den ausgearbeiteten System-Prompt in `mentor-api/prompt.ts` einsetzen (Entwurf liegt im
Chatverlauf / kann neu erzeugt werden), committen → Vercel deployt automatisch.
