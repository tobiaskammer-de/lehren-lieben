# Wissensbasis des Lehrkraftmentors

Aus den Podcast-Transkripten wird die Datei `mentor-api/corpus.json` gebaut — die
„Datenbank", aus der der Chatbot (siehe `mentor-api/`) zur Laufzeit zitiert.
Zweischichtig (**Hybrid**):

- **Insight-Karten** (`distilled/<id>.json`) — destillierte Erkenntnisse je Folge:
  Thema, Kernaussage, wer es gesagt hat (Preisträger:in vs. Moderator), Beleg-Zitat,
  **Zeitmarke** und **Deeplink** zur Minute. Das ist die kuratierte, **editierbare**
  Quelle der Wahrheit — Korrekturen hier landen beim nächsten Build im Corpus.
- **Roh-Häppchen** — ~1.800-Zeichen-Stücke der Originaltranskripte (Beleg-Ebene),
  beim Build aus `extracted/` erzeugt.

## Pipeline

```
DOCX/SRT  ──①──>  extracted/*.txt (+ episode-map.json)  ──②──>  distilled/*.json  ──③──>  mentor-api/corpus.json
        extract_transcripts.py            (Destillation je Folge)            build-corpus.mjs
```

1. `python3 scripts/extract_transcripts.py` — splittet die Sammel-DOCX (+ SRT) in
   Einzelfolgen mit erhaltenen Zeitmarken, matcht jede Folge per „#Nummer" auf ihre
   Podigee-URL. Quelle = die DOCX auf dem Desktop (Pfade oben im Skript).
2. **Destillation** je Folge → `distilled/<id>.json` (Karten-Schema s. u.).
3. `npm run build:corpus` — baut `mentor-api/corpus.json` aus Karten + Roh-Häppchen.

`extracted/` ist **gitignored** (rohe Volltexte, regenerierbar, öffentliches Repo).

## Karten-Schema (`distilled/*.json`)

Array von Objekten: `topic`, `insight`, `speaker`, `role`
(`Moderator` | `Gast/Experte` | `Preisträger:in` | `unklar`), `quote` (wörtlich),
`tsDisplay` (Zeitmarke verbatim), `category`
(`Methode`|`Tipp`|`Tool`|`Haltung`|`Fallbeispiel`|`Fortbildung`|`Literatur`).

## Abdeckung (Stand 2026-06-21)

29 Folgen destilliert, 763 Karten.

- **Bester Job der Welt:** #1–#17, #20 sowie „Vom Krankenbett ins Klassenzimmer".
- **Ausgezeichnete Lehrkräfte:** #1, #2, #3, #6, #8, #9, #10, #11, #12, #13.

**Noch fehlende Transkripte (Lücken):**
- Bester Job: **#18 KIPPPUNKT (Hurrelmann)**, **#19 Unterrichtseinstiege**,
  **Minifolge „erstes Mal"**.
- Ausgezeichnete: **#4 Björn Schlese**, **#5 Schlese Teil 2**, **#7 Tobias Rusteberg**.

(Im DOCX liegt zusätzlich #14 Werner Fick — noch nicht auf Podigee veröffentlicht,
daher bewusst nicht im Live-Corpus.)

## Neue Folge nachliefern

1. Transkript in die jeweilige Sammel-DOCX (auf dem Desktop) ergänzen.
2. `python3 scripts/extract_transcripts.py` neu laufen lassen.
3. Die neue `extracted/<id>.txt` destillieren → `distilled/<id>.json`.
4. `npm run build:corpus`, dann `corpus.json` committen & pushen.

## Smartere Suche aktivieren (Embeddings, optional)

Ohne Key läuft die Laufzeit-Suche **lexikalisch** (keyless, funktioniert sofort).
Für semantische Vektor-Suche:

1. `OPENAI_API_KEY` in `.env` (Projekt-Root) setzen → `npm run build:corpus`
   (schreibt jetzt Vektoren in `corpus.json`).
2. Denselben `OPENAI_API_KEY` in den **Vercel**-Env-Vars des Projekts hinterlegen
   (Laufzeit-Embedding der Frage). Dann schaltet `mentor-api` automatisch auf
   Vektor-Suche um.
