#!/usr/bin/env python3
"""Add words to the French trainer from the terminal.

    python3 tool/add.py "le chien = the dog"
    python3 tool/add.py "le chien = the dog" "la maison = the house"
    python3 tool/add.py "le chien | n.m. | the dog | note about usage"

Fields are french | pos | english | note. The short form (french = english) fills
pos and note as blank. Duplicates on the french side are skipped.

Every add commits and pushes vocab.json, so the words reach the phone without a
separate deploy step. Only vocab.json is staged, so work in progress on the rest
of the app stays local. Pass --no-push to skip it.
"""
import gzip
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).parent
VOCAB = HERE / "vocab.json"
IPA = HERE / "ipa.json.gz"

_ipa_cache = None

ARTICLE = re.compile(r"^(le|la|les|mon|ma|mes|ton|ta|tes|son|sa|ses)\s+", re.I)


def dedupe_key(fr):
    """Two entries are the same word when they differ only by the oe ligature or a
    leading definite/possessive article. Indefinite articles are left alone: "un peu"
    is its own word, not a determiner in front of "peu"."""
    return ARTICLE.sub("", fr.strip().lower().replace("\u0153", "oe").replace("\u00e6", "ae"))



def lookup(fr):
    """Pronunciation and part of speech for a single word, from Lexique 3.83.

    Single words only: composing a phrase's IPA from its parts would ignore liaison
    and elision, and a wrong pronunciation is worse than none.
    """
    global _ipa_cache
    if not IPA.exists():
        return "", ""
    # "le chien" is the documented way to add a noun, so look past the article
    bare = re.sub(r"^(le|la|les|un|une|du|de la|l'|de l')\s*", "", fr.strip(), flags=re.I)
    if " " in bare:
        return "", ""
    if _ipa_cache is None:
        with gzip.open(IPA, "rt", encoding="utf-8") as f:
            _ipa_cache = json.load(f)
    ipa, pos = _ipa_cache.get(bare.lower(), ["", ""])
    return ipa, pos


def push(added):
    """Commit vocab.json alone and push. Returns True if the words are live."""
    names = ", ".join(e["fr"] for e in added)
    if len(names) > 60:
        names = names[:57] + "..."
    message = f"Add {len(added)} word{'s' if len(added) > 1 else ''}: {names}"
    for cmd in (["git", "add", "--", VOCAB.name],
                ["git", "commit", "-q", "-m", message],
                ["git", "push", "-q"]):
        r = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"  ! push failed at `{' '.join(cmd)}`: {(r.stderr or r.stdout).strip()}")
            print("  ! the words are saved locally but are NOT on the phone yet")
            return False
    print(f"  ↑ pushed: {message}")
    return True


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
    wanted_push = "--no-push" not in argv
    argv = [a for a in argv if a != "--no-push"]
    if not argv:
        print(__doc__)
        return 1

    data = json.loads(VOCAB.read_text()) if VOCAB.exists() else {"version": 1, "words": []}
    words = data["words"]
    existing = {dedupe_key(w["fr"]) for w in words}
    today = date.today().isoformat()

    added, skipped = [], []
    for raw in argv:
        entry = parse(raw)
        if dedupe_key(entry["fr"]) in existing:
            skipped.append(entry["fr"])
            continue
        ipa, pos = lookup(entry["fr"])
        entry["ipa"] = ipa
        entry["pos"] = entry["pos"] or pos
        entry["id"] = next_id(words)
        entry["added"] = today
        words.append({k: entry[k] for k in ("id", "fr", "pos", "en", "note", "ipa", "added")})
        existing.add(dedupe_key(entry["fr"]))
        added.append(entry)

    VOCAB.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")

    for e in added:
        shown = f"  + {e['id']}  {e['fr']}"
        if e["ipa"]:
            shown += f"  {e['ipa']}"
        print(f"{shown}  =  {e['en']}")
    for fr in skipped:
        print(f"  · already there, skipped: {fr}")
    print(f"{len(added)} added, {len(words)} words total")

    if added and wanted_push and not push(added):
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)
