# français

A flashcard site. Each card is a French sentence with one word marked. Reveal shows the English,
the gloss, and speaks the sentence. Grade it 1 to 4 and the card comes back on a fixed ladder:
1, 3, 8, 18, 40, 90 days. Anything missed replays in the same sitting and goes on the gaps list.

Words come from three places, shown on the home page: the Duolingo import, words collected by
hand, and the 3,000 most frequent French words. Duolingo words are checked first; the list
feeds in at 40 a day once that is done.

The rules of the ladder, grading, gaps and retiring are in `../ladder.md`.

## Using it

Live at https://ammaarkhan.github.io/learn-french-web/, and that is the one to use: it syncs, so
the phone and the laptop share one ladder. Space reveals, 1 to 4 grades, 5 retires a word you
already own. The gaps tab lists what is still open and can run them as practice, which writes
nothing to the ladder.

## Sync

Progress lives in `progress.json` in the private `learn-french-data` repo. Each device needs the
fine-grained GitHub token once (Contents: read and write on that repo); it stays in that browser.
The dot in the masthead: grey is saved, hollow is offline and retrying, red is not saving. The
home page shows when progress last reached the repo. Served from `localhost` the app keeps
progress in that browser only, for development.

Two devices merge per card by timestamp. That is also why any script that writes `progress.json`
must run only when no sitting is open anywhere.

## How to

**Add a word.** Pushes itself.

    python3 add.py "le chien = the dog"
    python3 add.py "la maison | n.f. | the house | note"

Add only what he asks for. Nouns take `le`/`la`; a vowel-initial noun goes bare (`histoire`).
Before adding, check `progress.json` for `r:f-<word>`: a list word he has already reviewed must
not be hand-added, or its history is orphaned.

**Fix a gloss or sentence.** Edit `vocab.json`, or `frequency-3000.json` for an `f-` word. Tag a
hand-written gloss `en_src: "hand"` and a hand-written sentence `ex.src: "hand"`. Commit, push.
Wiktionary often leads with an obscure sense and the sentence picker matches any sense in the
gloss, so check the first sense and the sentence agree.

**Retire words.** `python3 ../data/mark_known.py je tu "ça va"`

**Pull Duolingo forward.** `python3 ../data/pull_forward.py 80` makes the next 80 unchecked
Duolingo cards due today.

**Deploy.** Bump `?v=N` on both lines of `index.html`, commit, push, then curl the live URL for a
string from the change until it appears. Pages lags by a minute or so.

**Rebuild the list.** Needs `fra.txt` (36 MB, not checked in):

    curl -O https://www.manythings.org/anki/fra-eng.zip && unzip fra-eng.zip
    python3 build_pool.py Lexique383.tsv kaikki-fr.jsonl frequency-3000.json
    python3 build_order.py --dry-run     # then without the flag
    python3 fill_sentences.py --dry-run  # sentences for hand-added words only

## Files

| File | What |
|---|---|
| `index.html`, `app.js`, `styles.css` | The app. No build step. |
| `vocab.json` | Hand-collected words, including the Duolingo import (`src: "duolingo"`) |
| `frequency-3000.json` | The list: 2,997 lemmas with gloss, IPA and a sentence, in teaching order |
| `add.py` | Adds a word, fills POS and IPA from `ipa.json.gz`, pushes |
| `curriculum.py`, `build_order.py` | The 34 situations and the teaching order |
| `build_pool.py`, `fill_sentences.py` | Build the list; attach sentences to hand words |

## Where the data comes from

| What | Source | Licence |
|---|---|---|
| Frequency, lemma, POS, gender, IPA | Lexique 3.83, http://www.lexique.org | CC BY-SA |
| English glosses | English Wiktionary via https://kaikki.org/dictionary/French/ | CC BY-SA 3.0 |
| Example sentences | Tatoeba, https://tatoeba.org, `fra-eng` export | CC BY 2.0 FR |

`frequency-3000.json` is a derivative of Lexique and Wiktionary and is redistributed under the
same terms. Every sentence carries `ex.src`: `tatoeba` is an unmodified pair verified against
`fra.txt`, `hand` was written for this project.
