#!/usr/bin/env python3
"""
Extrahiert die einzelnen Podcast-Folgen aus den aufbereiteten Sammel-DOCX
(+ #18 aus dem Schneide-Bot-SRT) in saubere Einzeldateien mit erhaltenen
Zeitmarken und baut eine Episoden->Podigee-URL-Tabelle.

Quelle der Wahrheit fuer Inhalte: die DOCX/SRT auf dem Desktop.
Ausgabe:
  transcripts/extracted/<id>.txt      (eine Datei je Folge, mit Zeitmarken)
  transcripts/episode-map.json        (Metadaten + Podigee-URL je Folge)

Aufruf: python3 scripts/extract_transcripts.py
"""
import zipfile, re, json, os, sys, urllib.request, xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "transcripts", "extracted")
MAP_PATH = os.path.join(ROOT, "transcripts", "episode-map.json")
os.makedirs(OUT_DIR, exist_ok=True)

DESKTOP = os.path.expanduser("~/Desktop")
DOCX_BJDW = os.path.join(DESKTOP, "TRANSSKRIPTE Folgen Lehrkraft_BesterJobDerWeltV1.3.docx")
DOCX_AUSG = os.path.join(DESKTOP, "Transskripte zu den Podcastfolgen DEUTSCHLANDS AUSGEZEICHNETE LEHRKRÄFTE_V1.4.docx")
SRT_18 = os.path.join(DESKTOP, "Code-Personalities/Schneide-Bot/02_work/transcript.srt")

FEEDS = {
    "Bester Job der Welt": "https://lehrkraftbesterjobderwelt.podigee.io/feed/mp3",
    "Ausgezeichnete Lehrkräfte": "https://deutschlandsausgezeichnetelaehrkraefte.podigee.io/feed/mp3",
}

TS_RE = re.compile(r"\b\d{1,3}:\d{2}(?:[.,]\d+)?")


def docx_text(path):
    xml = zipfile.ZipFile(path).read("word/document.xml").decode("utf-8", "ignore")
    text = re.sub(r"<[^>]+>", " ", xml)
    # HTML-Entities grob aufloesen
    for a, b in [("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&#39;", "'"), ("&nbsp;", " ")]:
        text = text.replace(a, b)
    # Vollstaendig flatten -> Marker-Erkennung (Folge N: / Podcast mit) ist robust;
    # Lesbarkeit (Zeilen je Aussage) stellt clean_segment wieder her.
    return re.sub(r"\s+", " ", text)


def clean_segment(seg):
    """Zeilen aufraeumen, Zeitmarken als Absatzanfang setzen."""
    seg = re.sub(r"[ \t]+", " ", seg)
    # Newline vor 'Sprecher (mm:ss...)' setzen -> jede Aussage in eigene Zeile
    seg = re.sub(
        r"\s*([A-Za-zÄÖÜäöüß'’.\-]+(?:\s+[A-Za-zÄÖÜäöüß'’.\-]+){0,3})\s*(\(\d{1,3}:\d{2}(?:[.,]\d+)?\))",
        r"\n\1 \2 ",
        seg,
    )
    lines = [ln.strip() for ln in seg.split("\n")]
    lines = [ln for ln in lines if ln]
    return "\n".join(lines).strip()


def fetch_feed_map():
    """(show, num) -> {url, title}  aus den Podigee-Feeds."""
    m = {}
    for show, url in FEEDS.items():
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "lehrenlieben builder"})
            data = urllib.request.urlopen(req, timeout=30).read()
            root = ET.fromstring(data)
            for it in root.find("channel").findall("item"):
                title = (it.findtext("title") or "").strip()
                link = (it.findtext("link") or "").strip()
                mm = re.search(r"#\s?(\d+)", title)
                if mm:
                    m[(show, int(mm.group(1)))] = {"url": link, "title": title}
        except Exception as e:
            print(f"  [WARN] Feed {show} nicht erreichbar: {e}", file=sys.stderr)
    return m


def slugify(s):
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")[:50]


def main():
    feedmap = fetch_feed_map()
    episodes = []

    # ---------- Bester Job der Welt: split nach 'Folge N:' + Timestamp-Dichte ----------
    text = docx_text(DOCX_BJDW)
    matches = list(re.finditer(r"Folge\s*(\d+)\s*:", text))
    best = {}  # num -> (segment, ts_count)
    for i, mt in enumerate(matches):
        num = int(mt.group(1))
        start = mt.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        seg = text[start:end]
        ts = len(TS_RE.findall(seg))
        if ts >= 15 and (num not in best or ts > best[num][1]):
            best[num] = (seg, ts)
    for num, (seg, ts) in sorted(best.items()):
        fm = feedmap.get(("Bester Job der Welt", num), {})
        title = fm.get("title") or f"#{num}"
        title = re.sub(r"^#\s?\d+:\s*", "", title)
        ep_id = f"bjdw-{num:02d}"
        body = clean_segment(seg)
        episodes.append({
            "id": ep_id, "show": "Bester Job der Welt", "cls": "amber",
            "ep": f"#{num}", "num": num, "title": title,
            "url": fm.get("url", ""), "source": "docx", "timestamps": ts,
            "chars": len(body), "file": f"extracted/{ep_id}.txt",
        })
        write_episode(ep_id, "Bester Job der Welt", f"#{num}", title, fm.get("url", ""), body)

    # ---------- #18 KIPPPUNKT (Hurrelmann) aus SRT ----------
    if os.path.exists(SRT_18):
        srt = open(SRT_18, encoding="utf-8", errors="ignore").read()
        body = srt_to_text(srt)
        fm = feedmap.get(("Bester Job der Welt", 18), {})
        title = re.sub(r"^#\s?\d+:\s*", "", fm.get("title") or "KIPPPUNKT – Prof. Klaus Hurrelmann")
        ep_id = "bjdw-18"
        episodes.append({
            "id": ep_id, "show": "Bester Job der Welt", "cls": "amber",
            "ep": "#18", "num": 18, "title": title, "url": fm.get("url", ""),
            "source": "srt", "timestamps": len(TS_RE.findall(body)),
            "chars": len(body), "file": f"extracted/{ep_id}.txt",
            "note": "Aus Schneide-Bot-SRT; keine Sprecher-Labels.",
        })
        write_episode(ep_id, "Bester Job der Welt", "#18", title, fm.get("url", ""), body)

    # ---------- Ausgezeichnete Lehrkräfte: split nach 'Podcast mit <Name>' ----------
    name_to_num = {
        "Aurich": 1, "Kammer": 2, "Schaller": 3, "Schmidt": 6, "Yousef": 8,
        "Maleki": 9, "Passchier": 10, "Dawan": 11, "Steffes": 12,
        "Broschwitz": 13, "Fick": 14,
    }
    text2 = docx_text(DOCX_AUSG)
    marks = list(re.finditer(r"Podcast mit ([A-ZÄÖÜ][^\n]{2,60})", text2))
    for i, mt in enumerate(marks):
        headname = mt.group(1)
        start = mt.end()
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text2)
        seg = text2[start:end]
        ts = len(TS_RE.findall(seg))
        if ts < 15:
            continue
        num = None
        for key, n in name_to_num.items():
            if key.lower() in headname.lower():
                num = n
                break
        if num is None:
            print(f"  [WARN] Ausgez.: Name nicht zuordenbar: {headname[:40]!r}", file=sys.stderr)
            continue
        if num == 14:
            # #14 Werner Fick: noch nicht auf Podigee veroeffentlicht -> aus Live-Corpus halten
            print("  [INFO] #14 Werner Fick uebersprungen (noch nicht veroeffentlicht).")
            continue
        fm = feedmap.get(("Ausgezeichnete Lehrkräfte", num), {})
        title = re.sub(r"^#\s?\d+:\s*", "", fm.get("title") or headname.strip())
        ep_id = f"ausgez-{num:02d}"
        body = clean_segment(seg)
        episodes.append({
            "id": ep_id, "show": "Ausgezeichnete Lehrkräfte", "cls": "teal",
            "ep": f"#{num}", "num": num, "title": title,
            "url": fm.get("url", ""), "source": "docx", "timestamps": ts,
            "chars": len(body), "file": f"extracted/{ep_id}.txt",
        })
        write_episode(ep_id, "Ausgezeichnete Lehrkräfte", f"#{num}", title, fm.get("url", ""), body)

    episodes.sort(key=lambda e: (e["show"], e["num"]))
    json.dump(episodes, open(MAP_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    print(f"\n{len(episodes)} Folgen extrahiert -> {OUT_DIR}")
    for e in episodes:
        u = "URL ok" if e["url"] else "!! KEINE URL"
        print(f"  {e['id']:<11} {e['ep']:>4} ts={e['timestamps']:<4} {e['chars']:>6}c  {u}  {e['title'][:46]}")


def srt_to_text(srt):
    out = []
    for block in re.split(r"\n\s*\n", srt):
        lines = [l for l in block.splitlines() if l.strip()]
        if len(lines) < 2:
            continue
        tcline = next((l for l in lines if "-->" in l), None)
        if not tcline:
            continue
        start = tcline.split("-->")[0].strip()
        m = re.match(r"(\d+):(\d{2}):(\d{2})", start)
        if m:
            h, mi, s = int(m.group(1)), int(m.group(2)), int(m.group(3))
            disp = f"{h*60+mi}:{s:02d}"
        else:
            disp = "0:00"
        txt = " ".join(l for l in lines if "-->" not in l and not l.strip().isdigit()).strip()
        if txt:
            out.append(f"({disp}) {txt}")
    return "\n".join(out)


def write_episode(ep_id, show, ep, title, url, body):
    header = f"PODCAST: {show}\nFOLGE: {ep}\nTITEL: {title}\nURL: {url}\n{'='*60}\n\n"
    open(os.path.join(OUT_DIR, f"{ep_id}.txt"), "w", encoding="utf-8").write(header + body + "\n")


if __name__ == "__main__":
    main()
