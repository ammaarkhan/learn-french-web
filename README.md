# français

A French vocabulary trainer on a fixed spaced-repetition ladder: 1, 3, 8, 18, 40, 90 days.

Every card is a sentence with one word marked, not a bare word and its gloss. The words that
dominate the start of any frequency list — `de`, `ça`, `y`, `en` — have no stable English
translation to memorise, only a use, so a gloss card cannot teach them. The sentence can.

Cards speak on reveal, using the browser's built-in French voice — no audio files, no network. The
speaker button replays; the masthead toggle turns auto-play off. This sits where the IPA line used
to: IPA is only useful to someone who reads it.

Cards start as input (french to english). A word earns its output card (english to french)
once it reaches rung 3, which is also when the review queue starts shuffling order and mixing card
types. Grades are blank / struggled / got / fluent. Anything you blank or struggle on is requeued
inside the same session, so a session does not close until you have come back to it.

No streaks, no points. The gaps list is the score.

The scheduling model comes from the Spaced Interleaved Retrieval approach in the iCanStudy course.

## Running it

Static, no build step, no dependencies. Deployed to GitHub Pages; that deployment is the one to use,
since it works on a phone.

## Progress and sync

Review state lives in `progress.json` in a separate private repo, so every device shares one ladder.
On first open a device asks for a fine-grained GitHub token with `Contents: Read and write` on that
repo; it is kept in the browser's localStorage and sent only to the GitHub API.

Cards merge per id by `updatedAt` and gaps merge by dedupe, so two devices reviewing on the same day
do not overwrite each other.

A fine-grained token returns `404` rather than `403` for a repo it cannot see, so a failed write is
never reported as "offline" — that would retry forever, look healthy, and quietly keep every review
in one browser. Write failures raise a visible banner instead.

Served from `localhost` the app skips all of that and keeps progress in that browser only, which is
useful for development but means those reviews do not reach any other device.

## Adding words

    python3 add.py "le chien = the dog"
    python3 add.py "la maison | n.f. | the house | note about usage"

Fields are `french | pos | english | note`. Duplicates are skipped.

Part of speech and IPA are filled in automatically from `ipa.json.gz`, a 125,000-form lookup built
from Lexique 3.83, so neither has to be typed. A leading article is looked past, which means
`"le chien = the dog"` still finds `chien`. Phrases get no IPA on purpose: composing one from the
individual words would ignore liaison and elision, and a wrong pronunciation is worse than none.

## The word pool

`frequency-3000.json` holds the most frequent French lemmas — 2,999 after `clef` was dropped as a
duplicate spelling of `clé` — each with an English gloss, an IPA pronunciation and an example
sentence. Forty enter the ladder per calendar day. Promotion is computed from the date
rather than stored as a counter, so every device agrees without anything to merge, and re-ranking the
list later cannot detach a card from its history — card ids are keyed on the word (`f-chien`).

The intake is capped where it matters: a session takes every due *review*, but at most forty cards
you have never seen. Falling behind therefore lengthens the queue rather than the day.

That cap is per sitting rather than per day. Close a session with words still waiting and it offers
the next batch, so the daily pace is a floor rather than a ceiling — on a good day you can keep going
until the list runs out.

Words already in `vocab.json` are skipped, so anything added by hand is never duplicated. The
comparison is `dedupeKey()`, which folds the `oe` ligature and strips a leading definite or
possessive article — `soeur`, `sœur` and `ma sœur` are one word. Indefinite articles are left alone,
because `un peu` is its own entry and folding it to `peu` would drop `peu` from the curriculum.
`add.py` uses the same rule as `dedupe_key()`; the two must stay in step or a word enters twice.

Rebuild the list with:

    python3 build_pool.py Lexique383.tsv kaikki-fr.jsonl frequency-3000.json

### Teaching order and example sentences

The pool is not taught in frequency order. `curriculum.py` holds 34 situations — the unit titles
of Duolingo's French course, sequenced by what Ammaar actually says in a day — and `build_order.py`
pulls each situation's words forward, then orders everything else so that each new word arrives in
a sentence whose other words are already known.

Function words are held back and re-inserted at the point where the sentences already scheduled
have shown them three times, so the card lands after the word has been met rather than before.

    curl -O https://www.manythings.org/anki/fra-eng.zip && unzip fra-eng.zip
    python3 build_order.py --dry-run     # inspect
    python3 build_order.py               # write

`fra.txt` is not checked in; re-download it when rebuilding.

Words added later with `add.py` get no sentence — attaching one needs the Tatoeba file, which is not
kept in the repo. They fall back to the plain word-and-gloss card until one is attached:

    python3 fill_sentences.py --dry-run     # inspect
    python3 fill_sentences.py               # write

`fill_sentences.py` does the sentence half of `build_order.py` alone. It reuses the same picker and
scoring but writes only `vocab.json`, so the teaching order is left untouched — which is what you
want after an `add.py` run. Phrases with no single token to index on come back on a list to be
written by hand and tagged `ex.src = "hand"`.

### Sources and licence

Frequency, lemma, part of speech, gender and phonetics come from **Lexique 3.83**
(New, Pallier, Brysbaert & Ferrand — <http://www.lexique.org>), ranked by the geometric mean of its
film-subtitle and book frequencies so the list favours words common in both spoken and written
French. English glosses come from **English Wiktionary**, via the machine-readable extraction at
<https://kaikki.org/dictionary/French/>.

Example sentences come from **Tatoeba** (<https://tatoeba.org>), used under **CC BY 2.0 FR**.
Every sentence in `frequency-3000.json` is an unmodified Tatoeba pair, attached by `build_order.py`
straight from `fra.txt`; the project and its contributors are the authors.

In `vocab.json` each sentence carries `ex.src`, so provenance is visible in the data rather than
only asserted here. `"tatoeba"` is an unmodified pair, verified against `fra.txt` by exact match on
the French side. `"hand"` is a sentence written for this project, used where the corpus has nothing
usable for the sense being taught — `éclair` is the pastry to a learner and lightning to Tatoeba.
Every word in `vocab.json` has a sentence as of 2026-08-31: 143 tatoeba, 63 hand. A hand sentence
must be tagged; an untagged one is a mistake.

Glosses follow the same rule. Where the Wiktionary extraction returns a dictionary artifact instead
of a meaning — `soeur` arrived as *"nonstandard spelling of sœur"* — the gloss is corrected by hand
and marked `en_src: "hand"`. Four pool entries carry one: `soeur`, `voeu`, `noeud`, `l'une`. Note
that the pool holds only the `oe` spellings, so deleting those entries would remove the words from
the curriculum altogether rather than deduplicating them.

Both Lexique and Wiktionary are share-alike licensed (Lexique CC BY-SA, Wiktionary CC BY-SA 3.0), and `frequency-3000.json`
is a derivative of both. It is redistributed here under the same terms, with attribution as above.
