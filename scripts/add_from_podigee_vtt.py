#!/usr/bin/env python3
"""
Füllt Folgen-Lücken aus den offiziellen Podigee-Transkripten (VTT, mit Zeitmarken
+ Sprecher-Diarisierung). Lädt das VTT je Folge, fasst aufeinanderfolgende Cues
desselben Sprechers zu Turns zusammen, schreibt eine Einzelfolge-Datei in
transcripts/extracted/ und ergänzt transcripts/episode-map.json.

Aufruf: python3 scripts/add_from_podigee_vtt.py
Danach: die neue(n) extracted/<id>.txt destillieren, dann npm run build:corpus.
"""
import re, os, json, urllib.request, xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXTRACTED = os.path.join(ROOT, "transcripts", "extracted")
MAP_PATH = os.path.join(ROOT, "transcripts", "episode-map.json")
os.makedirs(EXTRACTED, exist_ok=True)

FEED = "https://lehrkraftbesterjobderwelt.podigee.io/feed/mp3"
SHOW = "Bester Job der Welt"

# Welche Folgen aus diesem Feed nachziehen: ep-Nummer -> id
WANTED = {18: "bjdw-18", 19: "bjdw-19"}


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "lehrenlieben builder"})
    return urllib.request.urlopen(req, timeout=40).read()


def feed_items():
    root = ET.fromstring(fetch(FEED))
    items = {}
    for it in root.find("channel").findall("item"):
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        m = re.search(r"#\s?(\d+)", title)
        vtt = None
        for t in it.findall("{https://podcastindex.org/namespace/1.0}transcript"):
            if t.get("type") == "text/vtt":
                vtt = t.get("url")
        # Fallback ohne Namespace-Match
        if not vtt:
            for t in it.iter():
                if t.tag.endswith("transcript") and t.get("type") == "text/vtt":
                    vtt = t.get("url")
        if m:
            items[int(m.group(1))] = {"title": title, "url": link, "vtt": vtt}
    return items


def ts_disp(seconds):
    s = int(float(seconds))
    return f"{s // 60}:{s % 60:02d}"


def parse_vtt(text):
    """VTT -> Liste von (start_seconds, speaker, text), Cues geparst."""
    cues = []
    for block in re.split(r"\n\s*\n", text):
        lines = [l for l in block.splitlines() if l.strip() and l.strip() != "WEBVTT"]
        tc = next((l for l in lines if "-->" in l), None)
        if not tc:
            continue
        start = tc.split("-->")[0].strip()
        m = re.match(r"(?:(\d+):)?(\d{2}):(\d{2})", start)
        if not m:
            continue
        h = int(m.group(1) or 0)
        secs = h * 3600 + int(m.group(2)) * 60 + int(m.group(3))
        body = " ".join(l for l in lines if "-->" not in l).strip()
        spk = ""
        mm = re.match(r"(Speaker\s*\d+):\s*(.*)", body)
        if mm:
            spk, body = mm.group(1), mm.group(2)
        if body:
            cues.append((secs, spk, body))
    return cues


def merge_turns(cues):
    """Aufeinanderfolgende Cues desselben Sprechers zu Turns zusammenfassen."""
    turns = []
    for secs, spk, body in cues:
        if turns and turns[-1][1] == spk:
            turns[-1] = (turns[-1][0], spk, turns[-1][2] + " " + body)
        else:
            turns.append((secs, spk, body))
    return turns


def write_episode(ep_id, ep, title, url, turns):
    header = f"PODCAST: {SHOW}\nFOLGE: #{ep}\nTITEL: {title}\nURL: {url}\n{'='*60}\n\n"
    lines = []
    for secs, spk, body in turns:
        prefix = f"{spk} " if spk else ""
        lines.append(f"{prefix}({ts_disp(secs)}) {body}")
    open(os.path.join(EXTRACTED, f"{ep_id}.txt"), "w", encoding="utf-8").write(header + "\n".join(lines) + "\n")
    return len(turns)


def main():
    items = feed_items()
    episodes = json.load(open(MAP_PATH, encoding="utf-8"))
    by_id = {e["id"]: e for e in episodes}
    for ep, ep_id in WANTED.items():
        info = items.get(ep)
        if not info or not info["vtt"]:
            print(f"  [WARN] #{ep}: kein VTT im Feed gefunden"); continue
        title = re.sub(r"^#\s?\d+:\s*", "", info["title"])
        turns = merge_turns(parse_vtt(fetch(info["vtt"]).decode("utf-8", "ignore")))
        n = write_episode(ep_id, ep, title, info["url"], turns)
        entry = {
            "id": ep_id, "show": SHOW, "cls": "amber", "ep": f"#{ep}", "num": ep,
            "title": title, "url": info["url"], "source": "podigee-vtt",
            "timestamps": n, "chars": 0, "file": f"extracted/{ep_id}.txt",
            "note": "Offizielles Podigee-VTT (diarisiert: Speaker-Nummern, keine Namen).",
        }
        by_id[ep_id] = entry
        print(f"  {ep_id}: #{ep} '{title[:45]}' -> {n} Turns, URL {info['url']}")
    episodes = sorted(by_id.values(), key=lambda e: (e["show"], e["num"]))
    json.dump(episodes, open(MAP_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"\nepisode-map.json aktualisiert: {len(episodes)} Folgen.")


if __name__ == "__main__":
    main()
