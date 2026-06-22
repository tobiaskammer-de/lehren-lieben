#!/usr/bin/env python3
"""
Wandelt lokal mit whisper-cli erzeugte VTTs (aus den Enclosure-MP3s) in
Einzelfolge-Transkripte um (transcripts/extracted/<id>.txt) und ergänzt
transcripts/episode-map.json. Für Folgen OHNE Podigee-Transkript.

Whisper-VTTs haben KEINE Sprecher-Labels; die Turn-Länge wird gedeckelt, damit
regelmäßig Zeitmarken erhalten bleiben (Minutengenauigkeit).

Aufruf: python3 scripts/whisper_to_extracted.py
"""
import re, os, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXTRACTED = os.path.join(ROOT, "transcripts", "extracted")
MAP_PATH = os.path.join(ROOT, "transcripts", "episode-map.json")

# vtt = Pfad zum lokalen whisper-VTT (in /tmp)
SPECS = [
    {"id": "bjdw-minifolge", "show": "Bester Job der Welt", "cls": "amber", "ep": "",
     "num": 17, "title": "Minifolge: Tobis und Alex' erstes Mal!",
     "url": "https://lehrkraftbesterjobderwelt.podigee.io/17-neue-episode", "vtt": "/tmp/mini.vtt"},
    {"id": "ausgez-05", "show": "Ausgezeichnete Lehrkräfte", "cls": "teal", "ep": "#5",
     "num": 5, "title": "Björn Schlese (Teil 2) mit seinen Schülern (Physik und Mathe)",
     "url": "https://deutschlandsausgezeichnetelaehrkraefte.podigee.io/5-new-episode", "vtt": "/tmp/ausgez-05.vtt"},
    {"id": "ausgez-07", "show": "Ausgezeichnete Lehrkräfte", "cls": "teal", "ep": "#7",
     "num": 7, "title": "Tobias Rusteberg - SEK I+II (Französisch und Deutsch)",
     "url": "https://deutschlandsausgezeichnetelaehrkraefte.podigee.io/7-new-episode", "vtt": "/tmp/ausgez-07.vtt"},
]


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
        if body:
            cues.append((secs, body))
    return cues


def merge(cues, max_chars=320):
    turns = []
    for secs, body in cues:
        if turns and len(turns[-1][1]) < max_chars:
            turns[-1] = (turns[-1][0], turns[-1][1] + " " + body)
        else:
            turns.append((secs, body))
    return turns


def main():
    episodes = json.load(open(MAP_PATH, encoding="utf-8"))
    by_id = {e["id"]: e for e in episodes}
    for s in SPECS:
        if not os.path.exists(s["vtt"]):
            print(f"  [SKIP] {s['id']}: VTT fehlt ({s['vtt']}) — noch nicht transkribiert?")
            continue
        turns = merge(parse_vtt(open(s["vtt"], encoding="utf-8").read()))
        ep_label = s["ep"] or "(ohne Nummer)"
        header = f"PODCAST: {s['show']}\nFOLGE: {ep_label}\nTITEL: {s['title']}\nURL: {s['url']}\n{'='*60}\n\n"
        lines = [f"({ts_disp(sec)}) {body}" for sec, body in turns]
        open(os.path.join(EXTRACTED, f"{s['id']}.txt"), "w", encoding="utf-8").write(header + "\n".join(lines) + "\n")
        by_id[s["id"]] = {
            "id": s["id"], "show": s["show"], "cls": s["cls"], "ep": s["ep"],
            "num": s["num"], "title": s["title"], "url": s["url"], "source": "whisper",
            "timestamps": len(turns), "chars": 0, "file": f"extracted/{s['id']}.txt",
            "note": "Lokal mit whisper-cli (turbo) aus der Audio-MP3; keine Sprecher-Labels.",
        }
        print(f"  {s['id']}: {ep_label} -> {len(turns)} Turns")
    episodes = sorted(by_id.values(), key=lambda e: (e["show"], e["num"]))
    json.dump(episodes, open(MAP_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"\nepisode-map.json: {len(episodes)} Folgen.")


if __name__ == "__main__":
    main()
