# français

A French vocabulary trainer on a fixed spaced-repetition ladder: 1, 3, 8, 18, 40, 90 days.

Cards start as recognition (french to english). A word earns its production card (english to french)
once it reaches rung 3, which is also when the review queue starts shuffling order and mixing card
types. Grades are blank / struggled / got / fluent. Anything you blank or struggle on is requeued
inside the same session, so a session does not close until you have come back to it.

No streaks, no points. The gaps list is the score.

The scheduling model comes from the Spaced Interleaved Retrieval approach in the iCanStudy course.

## Running it

Static, no build step, no dependencies:

    python3 -m http.server 8000

then open `http://localhost:8000/`. Review progress is kept in the browser's localStorage.

## Adding words

    python3 add.py "le chien = the dog"
    python3 add.py "la maison | n.f. | the house | note about usage"

Fields are `french | pos | english | note`. Duplicates are skipped.
