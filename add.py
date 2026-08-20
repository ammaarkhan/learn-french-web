#!/usr/bin/env python3
"""Add words to the French trainer from the terminal.

    python3 tool/add.py "le chien = the dog"
    python3 tool/add.py "le chien = the dog" "la maison = the house"
    python3 tool/add.py "le chien | n.m. | the dog | note about usage"

Fields are french | pos | english | note. The short form (french = english) fills
pos and note as blank. Duplicates on the french side are skipped.
"""
import json
import re
import sys
from datetime import date
from pathlib import Path

VOCAB = Path(__file__).parent / "vocab.json"


def parse(raw):
    if "|" in raw:
        parts = [p.strip() for p in raw.split("|")]
        parts += [""] * (4 - len(parts))
        fr, pos, en, note = parts[:4]
    elif "=" in raw:
        fr, en = [p.strip() for p in raw.split("=", 1)]
        pos, note = "", ""
    else:
        raise ValueError(f'cannot parse {raw!r}: use "french = english" or "french | pos | english | note"')
    if not fr or not en:
        raise ValueError(f"cannot parse {raw!r}: both french and english are required")
    return {"fr": fr, "pos": pos, "en": en, "note": note}


def next_id(words):
    n = max((int(re.sub(r"\D", "", w["id"]) or 0) for w in words), default=0)
    return f"w{n + 1:03d}"


def main(argv):
    if not argv:
        print(__doc__)
        return 1

    data = json.loads(VOCAB.read_text()) if VOCAB.exists() else {"version": 1, "words": []}
    words = data["words"]
    existing = {w["fr"].lower() for w in words}
    today = date.today().isoformat()

    added, skipped = [], []
    for raw in argv:
        entry = parse(raw)
        if entry["fr"].lower() in existing:
            skipped.append(entry["fr"])
            continue
        entry["id"] = next_id(words)
        entry["added"] = today
        words.append({k: entry[k] for k in ("id", "fr", "pos", "en", "note", "added")})
        existing.add(entry["fr"].lower())
        added.append(entry)

    VOCAB.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")

    for e in added:
        print(f"  + {e['id']}  {e['fr']}  =  {e['en']}")
    for fr in skipped:
        print(f"  · already there, skipped: {fr}")
    print(f"{len(added)} added, {len(words)} words total")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)
