#!/usr/bin/env python3
"""Sort every word in the deck into a tier, written to priority.json. The app reviews
lower tiers first and keeps tier 3 off the queue entirely.

  0  lesson   words from the tutor's lessons (lessons.txt, and every word added since L1)
  1  core     verbs and nouns: what he needs to say what he did today
  2  more     adjectives, numbers and the few adverbs that carry meaning
  3  later    phrases, pronouns, prepositions, conjunctions, interjections, filler adverbs

Ammaar's call (2026-11-26): lesson words first, then verbs and nouns; "in fact"-type phrases
and small words wait.

It also puts every word in one group for the Words page, first match wins: Asking questions
(QUESTIONS below), then its tutor lesson (lessons.txt blocks, LESSON_IDS for hand-added
words), then "Phrases and small words" if parked, then its topic from themes.json, else
Miscellaneous.

Run after editing lessons.txt or themes.json, or adding words:  python3 build_priority.py
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).parent

# Hand-added words carded straight from a lesson's homework, by id range (inclusive).
LESSON_IDS = {"L1": ("w668", "w691"), "L2": ("w698", "w724"), "L3": ("w725", "w754")}

QUESTIONS = {
    "où", "quand", "comment", "combien", "combien de", "pourquoi", "pourquoi pas", "qui", "quel",
    "quelle", "quoi", "qu'est-ce que", "qu'est-ce qui", "est-ce que", "à quelle heure",
    "avec qui", "d'où", "quelle heure est-il ?", "combien ça coûte", "comment ça va",
    "comment vas-tu", "comment allez-vous", "comment tu t'appelles", "tu viens d'où",
    "quoi de neuf", "lequel",
}

# Topic groups for themes.json, in page order. Lessons come before them, Questions after the
# lessons, Miscellaneous and the parked words last.
THEMES = [
    ("people", "People and family"), ("home", "Home"), ("food", "Food and drink"),
    ("work", "Work and study"), ("town", "Town and getting around"),
    ("shopping", "Shopping and money"), ("time", "Time and numbers"),
    ("body", "Body and health"), ("nature", "Weather and nature"),
    ("feelings", "Feelings and opinions"), ("clothes", "Clothes"),
    ("leisure", "Free time and culture"), ("travel", "Travel and the world"),
    ("talk", "Talking and media"), ("society", "News and society"),
    ("actions", "Everyday actions"), ("describing", "Describing things"),
]
LESSONS_FROM = "2026-11-16"  # the first tutor lesson: everything added since is lesson material


def key(s):
    """Same as dedupeKey() in app.js and dedupe_key() in add.py."""
    s = s.lower().replace("œ", "oe").replace("æ", "ae")
    return re.sub(r"^(le|la|les|mon|ma|mes|ton|ta|tes|son|sa|ses)\s+", "", s)


def loose(s):
    """For matching lessons.txt only: drop articles, l', and the reflexive se/s'."""
    s = key(s)
    s = re.sub(r"^(l'|un |une |des |du |se |s')", "", s)
    return s


# Everyday adverbs and expressions that carry real meaning when describing a day. Kept in
# tier 2 even though their part of speech would park them.
KEEP = {
    "aujourd'hui", "demain", "hier", "maintenant", "ce soir", "ce matin", "d'habitude",
    "déjà", "ensemble", "beaucoup", "un peu", "trop", "loin", "près", "dehors", "vite",
    "lentement", "bientôt", "encore", "seulement", "tout le temps", "en retard", "à l'heure",
    "à pied", "en vacances", "en ville", "à la maison", "chez moi", "le petit déjeuner",
    "la salle de sport", "après-midi", "animal de compagnie", "une pause", "la personne",
    "la station de métro", "le ticket de caisse", "le jus d'orange", "le maillot de bain",
    "matin", "soir", "midi", "toujours", "souvent", "parfois", "jamais", "tôt", "tard",
}

# Added since L1 but news words from the RFI homework, not lesson material.
NOT_LESSON = {"rejoindre", "dirigeant", "plaider", "frappe", "menace", "bande"}

# Small words whose tag would otherwise keep them in play.
PARK = {"mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses", "notre", "votre", "leur",
        "nos", "vos", "leurs", "enchanté", "quelque", "tel", "autre", "même", "chaque"}

CORE_POS = ("n", "v", "aux")         # nouns, verbs
MORE_POS = ("adj", "num")
ARTICLE = re.compile(r"^(le|la|l'|les|un|une) ")


def tier_for(w, lesson_keys):
    fr, pos = w["fr"], (w.get("pos") or "").strip()
    k, lk = key(fr), loose(fr)
    if k in NOT_LESSON:
        return 1
    if w.get("added", "") >= LESSONS_FROM or k in lesson_keys or lk in lesson_keys:
        return 0
    if fr.lower() in PARK or k in PARK:
        return 3
    if fr.lower() in KEEP or k in KEEP:
        return 2
    if pos.startswith("loc") or pos in ("phrase", "pron.", "prep.", "conj.", "interj.", "dét.", "det.", "art."):
        return 3
    if pos.startswith(CORE_POS):
        return 1
    if pos.startswith(MORE_POS):
        return 2
    if not pos and ARTICLE.match(fr.lower()):
        return 1                       # untagged but has an article: a noun
    if not pos and " " not in fr and fr.endswith(("er", "ir", "re")):
        return 1                       # untagged infinitive
    return 3                           # adverbs and untagged phrases


def main():
    lesson_keys = set()
    lesson_of = {}                      # key or loose key -> lesson slug, first block wins
    lessons = []                        # (slug, title) in file order
    current = None
    for line in (HERE / "lessons.txt").read_text().splitlines():
        line = line.strip()
        m = re.match(r"^# (L\d+) · (.+)$", line)
        if m:
            current = m.group(1)
            lessons.append((current, "Lesson %s · %s" % (current[1:], m.group(2))))
        elif line and not line.startswith("#"):
            for k in (key(line), loose(line)):
                lesson_keys.add(k)
                if current:
                    lesson_of.setdefault(k, current)
    themes = json.loads((HERE / "themes.json").read_text()) if (HERE / "themes.json").exists() else {}

    vocab = json.loads((HERE / "vocab.json").read_text())["words"]
    pool = json.loads((HERE / "frequency-3000.json").read_text())["words"]

    tiers, group = {}, {}
    for w in vocab + pool:
        k = key(w["fr"])
        if k in tiers:                  # a hand word wins over the list word it shadows
            continue
        tiers[k] = tier_for(w, lesson_keys)
        wid = w.get("id", "")
        by_id = next((l for l, (a, b) in LESSON_IDS.items() if a <= wid <= b and len(wid) == len(a)), None)
        if k in QUESTIONS or w["fr"].lower() in QUESTIONS:
            group[k] = "questions"
        elif k not in NOT_LESSON and (by_id or lesson_of.get(k) or lesson_of.get(loose(w["fr"]))):
            group[k] = by_id or lesson_of.get(k) or lesson_of.get(loose(w["fr"]))
        elif tiers[k] == 3:
            group[k] = "later"
        else:
            group[k] = themes.get(k, "misc")

    groups = ([{"slug": s, "title": t} for s, t in lessons]
              + [{"slug": "questions", "title": "Asking questions"}]
              + [{"slug": s, "title": t} for s, t in THEMES]
              + [{"slug": "misc", "title": "Miscellaneous"},
                 {"slug": "later", "title": "Phrases and small words, parked for later"}])
    out = {"tiers": tiers, "groups": groups, "group": group}
    (HERE / "priority.json").write_text(json.dumps(out, ensure_ascii=False, sort_keys=True))
    counts = [sum(1 for t in tiers.values() if t == n) for n in range(4)]
    print("lesson %d · verbs and nouns %d · more %d · later %d" % tuple(counts))
    sizes = {g["slug"]: sum(1 for v in group.values() if v == g["slug"]) for g in groups}
    print("groups: " + ", ".join("%s %d" % (s, n) for s, n in sizes.items()))


if __name__ == "__main__":
    main()
