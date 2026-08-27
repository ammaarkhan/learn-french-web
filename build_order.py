"""Rebuild the pool's teaching order and attach an example sentence to every word.

Two jobs, one pass, because they depend on each other: which sentence is usable for a
word depends on what is already known, and what is already known depends on the order.

    python3 build_order.py [--tatoeba fra.txt]

Reads  frequency-3000.json, vocab.json, curriculum.py, a Tatoeba fra-eng export
Writes frequency-3000.json (reordered, each word gains "ex"), vocab.json (gains "ex")

ORDER
  1. Situations from curriculum.py, in Ammaar's PRIORITY order. A pool word whose
     lemma matches a seed is pulled into that situation; within a situation, frequency.
  2. Everything unclaimed follows in frequency order.
  3. Function words are lifted out of both and re-inserted at the point where the
     sentences already scheduled have shown them MIN_ENCOUNTERS times, so the card
     arrives after the word has been met, not before.

SENTENCES
  Tatoeba fra-eng, CC-BY 2.0 FR (https://tatoeba.org). Candidates are scored for
  i+1 (how many other words are already known), length, and literalness; the winner
  is stored with character offsets marking the target word for highlighting.
"""

import argparse, json, os, re, sys, unicodedata
from collections import defaultdict

import curriculum as C

HERE = os.path.dirname(os.path.abspath(__file__))
POOL = os.path.join(HERE, "frequency-3000.json")
VOCAB = os.path.join(HERE, "vocab.json")

# œ and æ sit outside the à-ÿ block, so they must be named or "sœur" tokenises as
# "s" + "ur" and every ligature word silently loses its sentence.
WORD_RE = re.compile(r"[a-zà-öø-ÿœæ'’\-]+", re.I)
tok = lambda s: WORD_RE.findall(s.lower())


def low(s):
    """Case-insensitive key that KEEPS accents. Folding them away collides French
       minimal pairs that are different words — a/à, ou/où, la/là, sur/sûr, du/dû —
       and a card built on the wrong one of those teaches the wrong word."""
    return s.lower().replace("\u2019", "'")


def fold(s):
    """Accent-blind key. Only for matching curriculum seeds to lemmas, never for
       choosing a sentence."""
    s = low(s).replace("œ", "oe").replace("æ", "ae")
    s = unicodedata.normalize("NFD", s)
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


# ---------- sentence corpus ----------

def load_sentences(path):
    """Tatoeba tab-delimited export: english <TAB> french <TAB> attribution."""
    out = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 2:
                continue
            en, fr = parts[0].strip(), parts[1].strip()
            ft, et = tok(fr), tok(en)
            if not (2 <= len(ft) <= 9) or len(et) < 2:
                continue
            # An English side far shorter than the French usually means the pair is
            # idiomatic ("De rien !" -> "No problem!"), which teaches the phrase but
            # not the word. Those are exactly what we must not build a card on.
            if len(et) * 2 < len(ft):
                continue
            out.append({"fr": fr, "en": en, "ft": ft, "norm": " ".join(low(t) for t in ft),
                        "toks": set(low(t) for t in ft)})
    return out


def build_index(sents):
    """Exact index, plus a folded one used only when the exact form never occurs."""
    idx, loose = defaultdict(list), defaultdict(list)
    for i, s in enumerate(sents):
        for t in s["toks"]:
            idx[t].append(i)
            loose[fold(t)].append(i)
    return idx, loose


PROPER = re.compile(r"(?<![.!?]\s)(?<!^)\b[A-ZÀ-Þ][a-zà-ÿ]+")


STOP_EN = {"the","a","an","to","of","in","on","at","it","is","be","and","or","that",
           "this","for","with","some","one","you","your","my","he","she","they","not"}


def gloss_words(en):
    """Content words from a card's English gloss, for checking the sentence agrees."""
    return {w for w in re.findall(r"[a-z]+", en.lower()) if w not in STOP_EN and len(w) > 2}


def pick_sentence(word, gloss, sents, idx, known, used):
    idx, loose = idx
    key = low(word)
    cands = idx.get(key) or loose.get(fold(word), [])
    gw = gloss_words(gloss)
    best, best_score = None, -1e9
    for i in cands:
        if i in used or sents[i]["norm"] in used:
            continue
        s = sents[i]
        unknown = sum(1 for t in s["toks"] if t != key and t not in known)
        score = -10.0 * unknown
        score -= 1.5 * abs(len(s["ft"]) - 6)
        score -= 3.0 * len(PROPER.findall(s["fr"]))
        if low(s["ft"][0]) == key:
            score -= 2.0            # sentence-initial: capitalised, less recognisable
        ratio = len(tok(s["en"])) / max(1, len(s["ft"]))
        if 0.7 <= ratio <= 1.6:
            score += 4.0            # length-matched pairs read as literal translations
        # The English side should show the sense the card teaches. Without this,
        # "merci" draws "Je suis a ta merci" / "I am at your mercy" — the noun, not
        # the thank-you, and the card then teaches the wrong word.
        if gw:
            en_toks = set(re.findall(r"[a-z]+", s["en"].lower()))
            hit = any(g in en_toks or any(e.startswith(g[:4]) for e in en_toks) for g in gw)
            score += 6.0 if hit else -7.0
        if score > best_score:
            best, best_score = i, score
            if unknown == 0 and score > 8:
                break
    if best is None:
        return None
    s = sents[best]
    m = re.search(r"(?<![\w'’])" + re.escape(word) + r"(?![\w'’])", s["fr"], re.I)
    if not m:                        # accent-folded match: locate token by token
        pos = 0
        for t in WORD_RE.finditer(s["fr"]):
            if low(t.group()) == key:
                pos = t.start()
                m = t
                break
        if m is None:
            return None
    used.add(best)
    used.add(s["norm"])              # curly vs straight apostrophes make near-duplicates
    return {"fr": s["fr"], "en": s["en"], "hl": [m.start(), m.end()]}


# ---------- ordering ----------

def claim_situations(words):
    """word index -> situation slug, for words a seed list claims."""
    by_slug = {slug: (title, seeds) for slug, title, seeds in C.SITUATIONS}
    lemma_at = defaultdict(list)
    for i, w in enumerate(words):
        lemma_at[low(w["fr"])].append(i)

    # Fallbacks for the shapes a seed and a pool lemma legitimately differ in:
    # the pool spells ligatures out (soeur, coeur, oeuf) and holds singular lemmas.
    loose = defaultdict(list)
    for k, v in lemma_at.items():
        loose[fold(k)].extend(v)

    def find(seed):
        for k in (low(seed), None):
            if k and lemma_at.get(k):
                return lemma_at[k]
        for k in (fold(seed), fold(seed).rstrip("s")):
            if loose.get(k):
                return loose[k]
        return []

    claim, order = {}, []
    for slug in C.PRIORITY:
        title, seeds = by_slug[slug]
        hits = []
        for seed in seeds:
            for i in find(seed):
                if i not in claim:
                    claim[i] = slug
                    hits.append(i)
        hits.sort(key=lambda i: words[i]["rank"])
        order.append((slug, title, hits))
    return claim, order


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tatoeba", default=os.path.join(HERE, "fra.txt"))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    pool = json.load(open(POOL, encoding="utf-8"))
    words = pool["words"]
    vocab = json.load(open(VOCAB, encoding="utf-8"))

    if not os.path.exists(args.tatoeba):
        sys.exit(f"missing {args.tatoeba} — see the README for the download line")
    sents = load_sentences(args.tatoeba)
    idx = build_index(sents)   # (exact, folded)
    print(f"{len(sents):,} usable sentences, {len(words):,} pool words, {len(vocab['words'])} hand-added")

    claim, situations = claim_situations(words)
    themed = sum(len(h) for _, _, h in situations)
    print(f"{themed} pool words claimed by {len(situations)} situations")

    # Function words come out of the running order; they are re-inserted by encounter.
    is_func = lambda w: w["pos"] in C.FUNCTION_POS
    seq = []
    for slug, title, hits in situations:
        for i in hits:
            if not is_func(words[i]):
                seq.append((i, slug))
    tail = [i for i, w in enumerate(words) if i not in claim and not is_func(w)]
    deferred = [i for i, w in enumerate(words) if is_func(w)]
    print(f"{len(deferred)} function words deferred to their encounter threshold")

    # Ammaar's own words are known from the start — they are already on his ladder.
    known = set(low(w["fr"]) for w in vocab["words"])
    for w in vocab["words"]:
        known.update(low(t) for t in tok(w["fr"]))

    # Cheap candidate lists for the readability sort: the shortest sentences per word.
    cand = {}
    for i in tail:
        ids = idx[0].get(low(words[i]["fr"])) or idx[1].get(fold(words[i]["fr"]), [])
        cand[i] = sorted(ids, key=lambda j: len(sents[j]["ft"]))[:40]

    used, final, seen_count = set(), [], defaultdict(int)
    pending = {low(words[i]["fr"]): i for i in deferred}

    def attach(i, slug):
        w = words[i]
        ex = pick_sentence(w["fr"], w.get("en", ""), sents, idx, known, used)
        w["situation"] = slug
        if ex:
            w["ex"] = ex
            for t in tok(ex["fr"]):
                seen_count[low(t)] += 1
        else:
            w.pop("ex", None)
        known.add(low(w["fr"]))
        final.append(i)

    def readability(i):
        """Fewest unknown words in any short sentence for this word. Lower is easier."""
        key = low(words[i]["fr"])
        best = 99
        for j in cand.get(i, []):
            u = sum(1 for t in sents[j]["toks"] if t != key and t not in known)
            if u < best:
                best = u
                if u == 0:
                    break
        return best

    def order_tail():
        """Greedy i+1: repeatedly take the words whose best sentence he can most
           nearly already read. Recomputed in rounds, since every word learned makes
           the next round's sentences more readable."""
        remaining, out = set(tail), []
        while remaining:
            scored = sorted((readability(i), words[i]["rank"], i) for i in remaining)
            batch = [i for _, _, i in scored[:100]]
            for i in batch:
                known.add(low(words[i]["fr"]))
                out.append(i)
            remaining.difference_update(batch)
        for i in out:                 # readability() mutated known; attach re-adds
            known.discard(low(words[i]["fr"]))
        return out

    seq += [(i, None) for i in order_tail()]

    for i, slug in seq:
        attach(i, slug)
        # any function word now met often enough earns its card here
        for key, j in list(pending.items()):
            if seen_count[key] >= C.MIN_ENCOUNTERS:
                del pending[key]
                attach(j, "function")
    for key, j in pending.items():           # never met the threshold; tail of the list
        attach(j, "function")

    for rank, i in enumerate(final, 1):
        words[i]["rank"] = rank
    pool["words"] = sorted(words, key=lambda w: w["rank"])
    pool["order"] = "situation spine (curriculum.py) + i+1 sentence walk"

    # Hand-added words get sentences too, against the full known set.
    got = 0
    for w in vocab["words"]:
        ex = pick_sentence(w["fr"], w.get("en", ""), sents, idx, known, used)
        if ex:
            w["ex"] = ex
            got += 1
    print(f"{got}/{len(vocab['words'])} hand-added words got a sentence")

    have = sum(1 for w in words if w.get("ex"))
    print(f"{have}/{len(words)} pool words got a sentence ({have*100//len(words)}%)")

    if args.dry_run:
        print("\nfirst 25 in the new order:")
        for w in pool["words"][:25]:
            ex = w.get("ex", {})
            print(f"  {w['rank']:>4} {w['fr']:<14} {w.get('situation') or '-':<16} {ex.get('fr','—')}")
        return

    json.dump(pool, open(POOL, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(vocab, open(VOCAB, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("written")


if __name__ == "__main__":
    main()
