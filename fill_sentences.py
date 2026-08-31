#!/usr/bin/env python3
"""Attach an example sentence to every vocab.json word that lacks one.

    python3 fill_sentences.py --dry-run
    python3 fill_sentences.py

A card is meant to be a sentence with the target word marked, but `add.py` cannot
attach one — that needs the Tatoeba corpus, which is not checked in. A full
`build_order.py` run would do it, but it also re-ranks the whole pool. This does the
sentence half alone: it reuses build_order's own picker and scoring and writes only
`vocab.json`, leaving the teaching order untouched.

Sentences it finds are unmodified Tatoeba pairs, tagged `ex.src = "tatoeba"`. Words
it cannot place — phrases with no single token to index on, proper nouns absent from
the corpus — are listed at the end for a hand-written sentence, which must be tagged
`ex.src = "hand"`.

Re-download the corpus first:
    curl -O https://www.manythings.org/anki/fra-eng.zip && unzip fra-eng.zip
"""
import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import build_order as B

VOCAB = HERE / "vocab.json"
POOL = HERE / "frequency-3000.json"
CORPUS = HERE / "fra.txt"

# A real space is required after the article, or the "ma" of "manger" is eaten and
# the word is looked up as "nger". Elided l' and d' attach directly and are stripped.
ARTICLE = re.compile(r"^(?:(?:le|la|les|un|une|des|mon|ma|mes)\s+|[ld]')", re.I)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="report, write nothing")
    args = ap.parse_args(argv)

    if not CORPUS.exists():
        print(f"! {CORPUS.name} is missing — see the header for the download command")
        return 1

    sents = B.load_sentences(CORPUS)
    idx = B.build_index(sents)
    vocab = json.loads(VOCAB.read_text())
    pool = json.loads(POOL.read_text())

    # Everything he has met or will meet counts as known, so a candidate sentence is
    # scored against his real vocabulary rather than against nothing.
    known = set()
    for w in vocab["words"] + pool["words"]:
        known.add(B.low(w["fr"]))
        known.update(B.low(t) for t in B.tok(w["fr"]))

    # Never hand him a sentence that is already on another card.
    used = set()
    for w in vocab["words"] + pool["words"]:
        if w.get("ex"):
            used.add(" ".join(B.low(t) for t in B.tok(w["ex"]["fr"])))

    need = [w for w in vocab["words"] if not w.get("ex")]
    if not need:
        print("every word already has a sentence")
        return 0

    got, missed = 0, []
    for w in need:
        bare = ARTICLE.sub("", w["fr"]).strip()
        if " " in bare or "..." in w["fr"]:
            missed.append(w["fr"])          # no single token to index on
            continue
        ex = B.pick_sentence(bare, w.get("en", ""), sents, idx, known, used)
        if not ex:
            missed.append(w["fr"])
            continue
        ex["src"] = "tatoeba"
        w["ex"] = ex
        got += 1
        print(f"  + {w['fr']:<18} {ex['fr']}")

    print(f"\n{got} of {len(need)} matched from Tatoeba")
    if missed:
        print(f"{len(missed)} need a hand-written sentence tagged ex.src = \"hand\":")
        for m in missed:
            print(f"   - {m}")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return 0
    VOCAB.write_text(json.dumps(vocab, ensure_ascii=False, indent=2) + "\n")
    print("vocab.json written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
