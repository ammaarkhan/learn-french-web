# français

A French vocabulary trainer on a fixed spaced-repetition ladder: 1, 3, 8, 18, 40, 90 days.

Cards start as recognition (french to english). A word earns its production card (english to french)
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
