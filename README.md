# français

A flashcard site. Each card is a French sentence with one word marked. Reveal shows the English,
the gloss, and speaks the sentence. Grade it and the card comes back on a fixed ladder; anything
missed replays in the same sitting and goes on the gaps list.

Live at https://ammaarkhan.github.io/learn-french-web/, and that is the one to use: it syncs, so
the phone and the laptop share one ladder. Space reveals, 1 to 4 grades, 5 retires a word you
already own. The gaps tab lists what is still open and can run them as practice, which writes
nothing.

## How it works

The one place for the mechanics. `app.js` is the implementation; nothing here needs it. The
ladder, grades, gaps and retiring are specified in `../ladder.md` and not repeated.

1. **Words.** Everything in `vocab.json` (hand-collected, plus the Duolingo import), then list
   words from `frequency-3000.json` on a drip: 40 a day since 2026-08-25, in the file's order.
   The drip is a function of the date, not a stored counter, so every device agrees. It stood
   still from 2026-09-08 and resumes on 2026-09-19 where it left off.

2. **Cards.** One French→English card per word from the start. The English→French card appears
   when the first card reaches rung 3. A card that has never been answered is due today at rung 0.
   In `progress.json` a card is `r:<word id>` or `p:<word id>`; hand words are `w001`..., list
   words `f-<word>`. Each record holds rung, due, reps, lapses, streak, updatedAt, known.

3. **The queue.** Every card whose due date is today or earlier (UTC), minus retired words.
   Reviews are never capped. Cards never answered before are capped at 40 per sitting, and at
   none until 2026-09-19. Until any word reaches rung 3 the order is fixed; after that it is
   shuffled and the two directions mix.

4. **A sitting.** A missed card is asked again before the sitting ends; that replay changes
   nothing on the ladder. Every grade saves to the browser at once and pushes 2.5 seconds
   later. Each sitting is one entry in the session log, rewritten as it goes, so a sitting
   abandoned halfway still counts.

5. **Sync.** Progress is `progress.json` in the private `learn-french-data` repo, read and
   written through the GitHub contents API with a fine-grained token (Contents: read and
   write) that each browser stores once. On open the browser shows its own copy, fetches the
   repo, and either merges and pushes (if it had unsaved work) or takes the repo copy. Merging
   is per card by timestamp, gaps and sessions by id. Every push is a commit, so `git log` in
   `data/` is the record of what reached the repo. On `localhost` nothing leaves the browser.

   The dot in the masthead: grey saved, pale violet syncing, hollow offline and retrying every
   20 seconds, red not saving with the reason on the home page. While it is red or hollow,
   every review since lives in that browser only. The repo file is read whole, and the API
   returns files up to 1 MB; it was 145 KB at 750 cards. When it nears the limit, drop the
   indent in all three writers (`app.js`, `mark_known.py`, `pull_forward.py`) together.

6. **The home page.** *Sources*: Duolingo words count as checked once answered more than once
   (they arrived as met once); other words count as met once answered at all. *Rung chart*:
   every answered card by its rung, rung 0 with 1d, retired words last. *Activity*: reps per
   UTC day from the session log, replays included. *Last saved*: the last push that landed,
   from any device. *Open gaps*: gap words whose card has not passed twice since.

**"Why does it show N due?"** `python3 ../data/due.py` prints what the repo says is due today,
by source and rung. A different number on screen means a device holds reviews the repo has not
seen: look at that device's dot.

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
