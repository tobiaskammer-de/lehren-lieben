#!/usr/bin/env python3
"""
Füllt Folgen-Lücken aus den offiziellen Podigee-Transkripten (VTT, mit Zeitmarken
+ Sprecher-Diarisierung). Lädt das VTT je Folge, fasst aufeinanderfolgende Cues
desselben Sprechers zu Turns zusammen, schreibt eine Einzelfolge-Datei in
transcripts/extracted/ und ergänzt transcripts/episode-map.json.

Aufruf: python3 scripts/add_from_podigee_vtt.py
Danach: die neue(n) extracted/<id>.txt destillieren, dann npm run build:corpus.

Hinweis: Nicht jede Folge hat ein VTT im Feed — fehlt es, wird die Folge
übersprungen (dann nur per lokalem Whisper aus dem Audio machbar).
"""
import re, os, json, urllib.request, xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXTRACTED = os.path.join(ROOT, "transcripts", "extracted")
MAP_PATH = os.path.join(ROOT, "transcripts", "episode-map.json")
os.makedirs(EXTRACTED, exist_ok=True)

FEEDS = {
    "Bester Job der Welt": "https://lehrkraftbesterjobderwelt.podigee.io/feed/mp3",
    "Ausgezeichnete Lehrkräfte": "https://deutschlandsausgezeichnetelaehrkraefte.podigee.io/feed/mp3",
}

# Welche Folgen nachziehen. Pro Eintrag: id, show, cls, und ein Matcher
# (ep-Nummer ODER ein Substring im Titel für unnummerierte Folgen).
SPECS = [
    {"id": "ausgez-04", "show": "Ausgezeichnete Lehrkräfte", "cls": "teal", "num": 4},
]


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "lehrenlieben builder"})
    return urllib.request.urlopen(req, timeout=40).read()


def feed_items(show):
    root = ET.fromstring(fetch(FEEDS[show]))
    out = []
    for it in root.find("channel").findall("item"):
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        m = re.search(r"#\s?(\d+)", title)
        vtt = None
        for x in it.iter():
            if x.tag.endswith("transcript") and x.get("type") == "text/vtt":
                vtt = x.get("url")
        out.append({"title": title, "url": link, "vtt": vtt, "num": int(m.group(1)) if m else None})
    return out


def find_item(items, spec):
    for it in items:
        if "num" in spec and it["num"] == spec["num"]:
            return it
        if "title_contains" in spec and spec["title_contains"].lower() in it["title"].lower():
            return it
    return None


def ts_disp(seconds):
    s = int(float(seconds))
    return f"{s // 60}:{s % 60:02d}"


def parse_vtt(text):
    cues = []
    for block in re.split(r"\n\s*\n", text):
        lines = [l for l in block.splitlines() if l.strip() and l.strip() != "WEBVTT"]
        tc = next((l for l in lines if "-->" in l), None)
        if not tc:
            continue
        m = re.match(r"(?:(\d+):)?(\d{2}):(\d{2})", tc.split("-->")[0].strip())
        if not m:
            continue
        secs = int(m.group(1) or 0) * 3600 + int(m.group(2)) * 60 + int(m.group(3))
        body = " ".join(l for l in lines if "-->" not in l).strip()
        spk = ""
        mm = re.match(r"(Speaker\s*\d+):\s*(.*)", body)
        if mm:
            spk, body = mm.group(1), mm.group(2)
        if body:
            cues.append((secs, spk, body))
    return cues


def merge_turns(cues, max_chars=320):
    """Aufeinanderfolgende Cues desselben Sprechers zusammenfassen — aber Turns
    bei ~max_chars abbrechen, damit regelmäßig frische Zeitmarken erhalten bleiben
    (wichtig bei NICHT diarisierten VTTs, sonst kollabiert alles zu einem Turn)."""
    turns = []
    for secs, spk, body in cues:
        if turns and turns[-1][1] == spk and len(turns[-1][2]) < max_chars:
            turns[-1] = (turns[-1][0], spk, turns[-1][2] + " " + body)
        else:
            turns.append((secs, spk, body))
    return turns


def write_episode(ep_id, show, ep_label, title, url, turns):
    header = f"PODCAST: {show}\nFOLGE: {ep_label}\nTITEL: {title}\nURL: {url}\n{'='*60}\n\n"
    lines = [f"{(spk + ' ') if spk else ''}({ts_disp(secs)}) {body}" for secs, spk, body in turns]
    open(os.path.join(EXTRACTED, f"{ep_id}.txt"), "w", encoding="utf-8").write(header + "\n".join(lines) + "\n")
    return len(turns)


def main():
    episodes = json.load(open(MAP_PATH, encoding="utf-8"))
    by_id = {e["id"]: e for e in episodes}
    cache = {}
    for spec in SPECS:
        show = spec["show"]
        if show not in cache:
            cache[show] = feed_items(show)
        info = find_item(cache[show], spec)
        if not info:
            print(f"  [WARN] {spec['id']}: Folge nicht im Feed gefunden"); continue
        if not info["vtt"]:
            print(f"  [WARN] {spec['id']}: kein VTT im Feed -> übersprungen (nur per Whisper machbar)"); continue
        num = spec.get("num")
        ep_label = f"#{num}" if num else ""
        title = re.sub(r"^#\s?\d+:\s*", "", info["title"])
        turns = merge_turns(parse_vtt(fetch(info["vtt"]).decode("utf-8", "ignore")))
        n = write_episode(spec["id"], show, ep_label, title, info["url"], turns)
        by_id[spec["id"]] = {
            "id": spec["id"], "show": show, "cls": spec["cls"], "ep": ep_label,
            "num": num or 0, "title": title, "url": info["url"], "source": "podigee-vtt",
            "timestamps": n, "chars": 0, "file": f"extracted/{spec['id']}.txt",
            "note": "Offizielles Podigee-VTT (diarisiert: Speaker-Nummern, keine Namen).",
        }
        print(f"  {spec['id']}: {ep_label} '{title[:45]}' -> {n} Turns, URL {info['url']}")
    episodes = sorted(by_id.values(), key=lambda e: (e["show"], e["num"]))
    json.dump(episodes, open(MAP_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"\nepisode-map.json aktualisiert: {len(episodes)} Folgen.")


if __name__ == "__main__":
    main()
