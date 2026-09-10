/* français — SIR ladder vocabulary trainer.
   Scheduling is the ladder from ~/Desktop/projects/quran-translation, see ../resources/ladder.md.
   No streaks, no points. The gaps list is the score. */

// ---------- constants ----------

// interval ladder in days. rung 0 = never passed. rung n -> RUNGS[n-1] days.
const RUNGS = [1, 3, 8, 18, 40, 90];
const MAX_RUNG = RUNGS.length;

// a word's output card unlocks once its input card reaches this rung
const MATURE_RUNG = 3;

/* A retired card. "Known" is a flag on the record, not a rung: the queue skips it, the chart
   gives it its own column past the ramp, and it never comes back (Ammaar's call, 2026-09-09).
   The far due date is a guard, so a stale cached build that ignores the flag still never
   draws it. Reversible by deleting the flag. */
const KNOWN_DUE = "2099-12-31";

/* Word intake. frequency-3000.json holds the 3,000 most frequent French lemmas
   (Lexique 3.83 + Wiktionary, see build_pool.py), ordered for teaching rather than by
   rank (see build_order.py). Words enter the ladder on a drip: INTAKE_PER_DAY of them
   per calendar day since INTAKE_START.

   Promotion is a pure function of the date, not a stored counter, so every device
   computes the same answer and there is nothing to merge or drift. The session cap
   below, not the promotion, is what keeps a day's work finite. */
const INTAKE_START = "2026-08-25";
const INTAKE_PER_DAY = 40;

/* A session takes every due review, but only this many cards never seen before.
   It is a cap per sitting, not per day: finish a session with words still waiting
   and the closing screen offers the next batch. The pace is a floor, not a ceiling. */
const NEW_PER_SESSION = 40;

/* The Duolingo practice-hub export was ingested on 2026-09-08: 439 words he had already been
   taught there went onto the ladder as met once, 40 a day to 2026-09-18, so they are checked
   rather than taught. While that runs, a session is reviews only, and the pool drip stands
   still instead of running 11 days ahead — it resumes on the day it left off. Both ends are
   dates, so nothing has to be switched back by hand. To clear the check faster, pull the
   next batch forward with data/pull_forward.py rather than lifting the hold. */
const INTAKE_PAUSE_FROM = "2026-09-08";
const NEW_PAUSE_UNTIL = "2026-09-19";   // exclusive: the first day new words come back

const newPaused = () => todayISO() < NEW_PAUSE_UNTIL;
const newPerSession = () => (newPaused() ? 0 : NEW_PER_SESSION);

const DATA_REPO = "ammaarkhan/learn-french-data";
const API = `https://api.github.com/repos/${DATA_REPO}/contents`;
const LS = { token: "lf.token", prog: "lf.progress.v1" };

/* On localhost the app keeps progress in this browser only: no token, no network, same app.
   Anywhere else it reads and writes progress.json in the private data repo, so every device
   sees the same ladder. */
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);

const PUSH_DEBOUNCE_MS = 2500;

const GRADES = [
  { key: "blank", name: "blank", gap: true },
  { key: "struggled", name: "struggled", gap: true },
  { key: "got", name: "got", gap: false },
  { key: "fluent", name: "fluent", gap: false },
];

// ---------- state ----------

const state = {
  words: [], // vocab.json words, then whatever the intake has promoted
  own: 0, // how many of state.words came from vocab.json
  pool: 0, // how many frequency words are promoted so far
  poolTotal: 0,
  token: localStorage.getItem(LS.token) || "",
  prog: null, // { data, sha, dirty }
  sync: "idle",
  writeError: null,
  view: "today",
  session: null,
  reveal: false,
};

// ---------- dates ----------

const iso = (d) => d.toISOString().slice(0, 10);
const todayISO = () => iso(new Date());
const stamp = () => new Date().toISOString();

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function daysUntil(dateStr) {
  const a = new Date(todayISO() + "T00:00:00");
  const b = new Date(dateStr + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

function whenText(dateStr) {
  const n = daysUntil(dateStr);
  if (n < 0) return `${-n}d overdue`;
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  return `in ${n}d`;
}

function ivlText(days) {
  if (days >= 30) return `${Math.round(days / 30)}mo`;
  return `${days}d`;
}

// ---------- progress ----------

function emptyProgress() {
  return { version: 1, cards: {}, gaps: [], sessions: [], updatedAt: null };
}

const P = () => state.prog.data;

function loadProgLocal() {
  try {
    const raw = localStorage.getItem(LS.prog);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    /* fall through to empty */
  }
  return null;
}

function saveProgLocal() {
  localStorage.setItem(LS.prog, JSON.stringify(state.prog));
}

/* Every mutation goes through here: persist locally at once, then push when the dust settles. */
function save() {
  state.prog.dirty = true;
  saveProgLocal();
  if (!LOCAL) schedulePush();
}

// ---------- github ----------

/* Encoded in chunks. Spreading the whole file into one fromCharCode call hits the engine's
   argument limit (about 124 KB in Chrome) and throws, which is how every push failed for a
   day once progress.json passed that size (2026-09-09). */
function b64encode(t) {
  const bytes = new TextEncoder().encode(t);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const b64decode = (t) =>
  new TextDecoder().decode(Uint8Array.from(atob(t.replace(/\n/g, "")), (c) => c.charCodeAt(0)));

async function ghGet(file) {
  const res = await fetch(`${API}/${file}`, {
    headers: { Authorization: `Bearer ${state.token}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const err = new Error(`GET ${file} ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const j = await res.json();
  return { data: JSON.parse(b64decode(j.content)), sha: j.sha };
}

async function ghPut(file, data, sha, message) {
  const body = { message, content: b64encode(JSON.stringify(data, null, 1)) };
  if (sha) body.sha = sha;
  const res = await fetch(`${API}/${file}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${state.token}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error(`PUT ${file} ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return (await res.json()).content.sha;
}

// ---------- sync ----------

function setSync(status) {
  state.sync = status;
  const dot = document.getElementById("sync-dot");
  if (dot) {
    dot.className = "sync-dot " + status;
    dot.title = { idle: "synced", syncing: "syncing", offline: "offline", error: "not saving" }[status];
  }
}

const newer = (a, b) => {
  if (!a) return b;
  if (!b) return a;
  return (b.updatedAt || "") > (a.updatedAt || "") ? b : a;
};

/* Two devices reviewing the same day must not clobber each other: cards merge per id by
   updatedAt, gaps and sessions concatenate and dedupe. */
function mergeProgress(a, b) {
  const out = emptyProgress();
  const keys = new Set([...Object.keys(a.cards || {}), ...Object.keys(b.cards || {})]);
  for (const k of keys) out.cards[k] = newer((a.cards || {})[k], (b.cards || {})[k]);

  const dedupe = (arr, keyf) => {
    const seen = new Set();
    return arr.filter((x) => {
      const k = keyf(x);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  out.gaps = dedupe(
    [...(a.gaps || []), ...(b.gaps || [])].sort((x, y) => (y.at || "").localeCompare(x.at || "")),
    (x) => x.id + x.at
  );
  out.sessions = dedupe(
    [...(a.sessions || []), ...(b.sessions || [])].sort((x, y) =>
      (y.at || "").localeCompare(x.at || "")
    ),
    (x) => x.id || x.at
  ).slice(0, 200);
  /* Keep the later save time, or the home page reads "never" after every merge. */
  out.updatedAt = (a.updatedAt || "") > (b.updatedAt || "") ? a.updatedAt : b.updatedAt || null;
  return out;
}

async function refreshRemote() {
  if (LOCAL || !state.token) return;
  setSync("syncing");
  try {
    const pr = await ghGet("progress.json");
    if (state.prog && state.prog.dirty) {
      state.prog = { data: mergeProgress(state.prog.data, pr.data), sha: pr.sha, dirty: true };
      saveProgLocal();
      schedulePush(0);
    } else {
      state.prog = { data: pr.data, sha: pr.sha, dirty: false };
      saveProgLocal();
      setSync("idle");
    }
    /* Remote progress can name words this device had not promoted yet. Re-run
       promotion against the merged cards before painting, or they stay invisible
       until the next reload. */
    if (state.rawPool) {
      state.words = state.words.slice(0, state.own);   // must land before intake reads it
      state.words = state.words.concat(intake(state.rawPool));
    }
    render();
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      setSync("error");
      state.token = "";
      localStorage.removeItem(LS.token);
      render("that key was not accepted. try again.");
    } else if (e.status === 404) {
      /* A fine-grained token returns 404, not 403, for a repo it cannot see. So this is either
         "progress.json does not exist yet" or "this key cannot see learn-french-data" and the
         app cannot tell them apart. Create it on first write and let a failed PUT say which. */
      state.prog = state.prog || { data: emptyProgress(), sha: null, dirty: true };
      state.prog.sha = null;
      state.prog.dirty = true;
      saveProgLocal();
      schedulePush(0);
      render();
    } else {
      setSync("offline");
    }
  }
}

let pushTimer = null;
function schedulePush(ms = PUSH_DEBOUNCE_MS) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushProgress, ms);
}

/* The home page re-renders after a push settles so "last saved" and the error line are
   current; mid-session nothing is repainted, the dot alone reports. */
const repaintIfIdle = () => {
  if (!state.session || state.session.finished) render();
};

async function pushProgress() {
  if (LOCAL || !state.token || !state.prog || !state.prog.dirty) return;
  setSync("syncing");
  const wasSaved = state.prog.data.updatedAt;
  try {
    state.prog.data.updatedAt = stamp();
    const sha = await ghPut("progress.json", state.prog.data, state.prog.sha, `progress · ${stamp()}`);
    state.prog.sha = sha;
    state.prog.dirty = false;
    saveProgLocal();
    setSync("idle");
    state.writeError = null;
    repaintIfIdle();
  } catch (e) {
    /* Not saved, so the save time must not say otherwise. */
    state.prog.data.updatedAt = wasSaved;
    if (e.status === 409 || e.status === 422) {
      try {
        const remote = await ghGet("progress.json");
        state.prog.data = mergeProgress(state.prog.data, remote.data);
        state.prog.sha = remote.sha;
        state.prog.data.updatedAt = stamp();
        state.prog.sha = await ghPut(
          "progress.json",
          state.prog.data,
          state.prog.sha,
          `progress merge · ${stamp()}`
        );
        state.prog.dirty = false;
        saveProgLocal();
        setSync("idle");
        state.writeError = null;
        repaintIfIdle();
      } catch (e2) {
        state.prog.data.updatedAt = wasSaved;
        setSync("error");
        failWrite(e2);
      }
    } else if (e.status === 401 || e.status === 403 || e.status === 404) {
      /* Never treat this as offline. Offline retries forever, looks fine, and silently keeps
         every review in this one browser. */
      setSync("error");
      failWrite(e);
    } else if (e.status === undefined && !(e instanceof TypeError)) {
      /* Not an HTTP answer and not the network: the app itself threw before or during the
         request. Retrying will not help, so say so instead of looking offline. */
      setSync("error");
      failWrite(e);
    } else {
      setSync("offline");
      setTimeout(schedulePush, 20000);
    }
  }
}

function failWrite(e) {
  state.writeError =
    e.status === 401 || e.status === 403 || e.status === 404
      ? "This key cannot write to learn-french-data. It needs that repo added to it with Contents: Read and write. Nothing is being saved beyond this browser until that is fixed."
      : `Could not save to the repo (${e.message || e}). Your work is still in this browser.`;
  render();
}

// ---------- intake ----------

/* How many frequency words are in play today. Pure function of the date: no counter,
   so two devices never disagree and a rebuilt pool cannot shift what you have seen. */
function intakeCount() {
  const days = -daysUntil(INTAKE_START); // days since the start, 0 on the first day
  if (days < 0) return 0;
  return (days + 1 - pausedDays()) * INTAKE_PER_DAY;
}

/* Whole days of the pause already elapsed. Subtracting them holds the promotion count still
   inside the window, so no day of the pool drip is skipped, only deferred. */
function pausedDays() {
  const t = todayISO();
  if (t <= INTAKE_PAUSE_FROM) return 0;
  const end = t < NEW_PAUSE_UNTIL ? t : NEW_PAUSE_UNTIL;
  return Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(INTAKE_PAUSE_FROM + "T00:00:00Z")) / 86400000);
}

/* Two entries are the same word when they differ only by the oe ligature or a leading
   definite/possessive article: "soeur" (pool) and "sœur" (hand-added), "ma sœur" and "sœur".
   Indefinite articles are deliberately left alone — "un peu" is its own word, not a
   determiner in front of "peu", and folding it would hide "peu" from the curriculum. */
const dedupeKey = (s) =>
  s
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/^(le|la|les|mon|ma|mes|ton|ta|tes|son|sa|ses)\s+/, "");

/* ids are keyed on the word itself ("f-chien"), not on rank, so re-ranking the pool
   later cannot detach a card from its history. */
function intake(pool) {
  state.poolTotal = pool.length;
  const mine = new Set(state.words.map((w) => dedupeKey(w.fr)));
  const cards = P().cards;
  const taken = [];
  let promoted = 0;
  for (const p of pool) {
    if (mine.has(dedupeKey(p.fr))) continue; // already collected by hand
    const id = "f-" + p.fr;
    /* Under the promotion count, or already started. The second clause matters
       whenever the pool is re-ordered: a word he has reviewed must never drop out
       of rotation because the rebuild pushed its rank past today's intake. */
    const started = cards["r:" + id] || cards["p:" + id];
    if (promoted >= intakeCount() && !started) continue;
    if (promoted < intakeCount()) promoted += 1;
    taken.push({ id, fr: p.fr, pos: p.pos, en: p.en, ipa: p.ipa, note: p.note || "", ex: p.ex });
  }
  state.pool = taken.length;
  return taken;
}

// ---------- cards ----------
// id shape: "r:w001" input (fr -> en), "p:w001" output (en -> fr)

const parseId = (id) => ({ dir: id.slice(0, 1), wid: id.slice(2) });
const wordOf = (id) => state.words.find((w) => w.id === parseId(id).wid);

function card(id) {
  return P().cards[id] || { rung: 0, due: todayISO(), reps: 0, lapses: 0 };
}

function wordIsMature(wid) {
  return card("r:" + wid).rung >= MATURE_RUNG;
}

const isKnown = (id) => !!card(id).known;
const wordIsKnown = (wid) => isKnown("r:" + wid);

/* Retire a word: both directions at once, or the output card would surface later on its
   own. Reps and lapses are kept, so the history survives an un-retire. */
function markKnown(wid) {
  for (const id of ["r:" + wid, "p:" + wid]) {
    P().cards[id] = { ...card(id), rung: MAX_RUNG, due: KNOWN_DUE, known: true, updatedAt: stamp() };
  }
  save();
}

/* Early stage: input only. Output unlocks at the maturity flip, which is
   what turns "one card type, fixed order" into "mixed types, shuffled". */
function activeIds() {
  const out = [];
  for (const w of state.words) {
    out.push("r:" + w.id);
    if (wordIsMature(w.id)) out.push("p:" + w.id);
  }
  return out;
}

function dueIds() {
  const t = todayISO();
  return activeIds().filter((id) => !isKnown(id) && card(id).due <= t);
}

/* A card counts as seen once it has been answered or retired. Words the drip has released
   but never shown stay out of the chart and the totals until they come up. */
const seen = (id) => card(id).reps > 0 || isKnown(id);
const seenIds = () => activeIds().filter(seen);

/* Where the words come from, three sources, each with done and to go.
   Duolingo words are checked (seeded as met once, so done means answered since);
   own words and list words are met (shown at least once). */
function sources() {
  const met = (w) => seen("r:" + w.id);
  const duo = state.words.filter((w) => w.src === "duolingo");
  const own = state.words.slice(0, state.own).filter((w) => w.src !== "duolingo");
  /* The list is the whole top 3,000. A list word he collected by hand counts as met through
     its hand card, so the total stays the list and nothing is counted twice. */
  const pool = state.rawPool || [];
  const handMet = new Set(state.words.slice(0, state.own).filter(met).map((w) => dedupeKey(w.fr)));
  const listTotal = pool.length;
  const listMet =
    state.words.slice(state.own).filter(met).length +
    pool.filter((p) => handMet.has(dedupeKey(p.fr))).length;
  const duoDone = duo.filter((w) => card("r:" + w.id).reps > 1 || isKnown("r:" + w.id)).length;
  return [
    { name: "Duolingo", total: duo.length, done: duoDone, verb: "checked" },
    { name: "Your own words", total: own.length, done: own.filter(met).length, verb: "met" },
    { name: "Top 3,000 list", total: listTotal, done: listMet, verb: "met" },
  ];
}

function anyMature() {
  return state.words.some((w) => wordIsMature(w.id));
}

// ---------- grading ----------

function rungAfter(rung, g) {
  if (g === "blank") return 0;
  if (g === "struggled") return Math.max(1, rung);
  if (g === "got") return Math.min(MAX_RUNG, rung + 1);
  if (g === "fluent") return Math.min(MAX_RUNG, rung + (rung >= MATURE_RUNG ? 2 : 1));
  return rung;
}

const daysForRung = (rung) => (rung === 0 ? 1 : RUNGS[rung - 1]);

function previewDays(id, g) {
  return daysForRung(rungAfter(card(id).rung, g));
}

/* `streak` counts scheduled passes since the card was last missed. The same-session requeue
   pass does not count: it is minutes later and proves nothing. Two in a row closes the card's
   gaps (Ammaar's rule, 2026-09-09). */
const GAP_CLOSES_AT = 2;

function grade(id, g, requeue = false) {
  const c = { ...card(id) };
  c.reps += 1;
  const missed = g === "blank" || g === "struggled";
  if (missed) c.lapses += 1;
  c.rung = rungAfter(c.rung, g);
  c.due = iso(addDays(new Date(), daysForRung(c.rung)));
  if (missed) c.streak = 0;
  else if (!requeue) c.streak = (c.streak || 0) + 1;
  c.updatedAt = stamp();
  P().cards[id] = c;

  if (missed) {
    const w = wordOf(id);
    P().gaps.unshift({ id, fr: w.fr, en: w.en, dir: parseId(id).dir, grade: g, at: stamp() });
  }
  pruneGaps();
  save();
}

// ---------- gaps ----------

/* A gap is open while its card has not yet passed GAP_CLOSES_AT scheduled reviews in a row.
   Nothing is stored on the gap itself: open/closed is read off the card, so two devices
   cannot disagree about it and a later miss reopens the old entries along with the new one. */
const gapOpen = (g) => !isKnown(g.id) && (card(g.id).streak || 0) < GAP_CLOSES_AT;

/* One row per card: the latest miss, and how many times it has been missed. */
function openGaps() {
  const rows = new Map();
  for (const g of P().gaps) {
    if (!gapOpen(g) || !wordOf(g.id)) continue;
    const r = rows.get(g.id);
    if (r) r.n += 1;
    else rows.set(g.id, { ...g, n: 1 });
  }
  return [...rows.values()];
}

/* Closed gaps are history: kept ninety days, then dropped so the file stays small. */
function pruneGaps() {
  const cutoff = iso(addDays(new Date(), -90));
  P().gaps = P().gaps.filter((g) => gapOpen(g) || g.at.slice(0, 10) >= cutoff);
}

// ---------- session ----------

function shuffle(a) {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}

const isFresh = (id) => card(id).reps === 0;

/* Reviews are never capped: a card that is due is due, and letting them pile up is
   how a ladder rots. New cards are capped, so the day's work stays finite no matter
   how far the intake has run ahead. Hand-collected words enter before pool words. */
function todaysQueue() {
  const due = dueIds();
  const fresh = due.filter(isFresh).slice(0, newPerSession());
  return due.filter((id) => !isFresh(id)).concat(fresh);
}

/* Early stage keeps a fixed order and one card type; once any word has matured the
   queue mixes order and type. Volume, order, type: the three SIR variables. */
function buildQueue() {
  const ids = todaysQueue();
  return anyMature() ? shuffle(ids) : ids;
}

function startSession(queue = buildQueue(), practice = false) {
  if (!queue.length) return;
  state.session = {
    queue,
    requeue: [],
    total: queue.length,
    done: 0,
    gaps: 0,
    started: todayISO(),
    sid: stamp() + ":" + Math.random().toString(36).slice(2, 8),
    practice,
  };
  state.reveal = false;
  go("review");
}

/* Practice: the open gaps as a session of their own, same cards, same grades, same requeue
   loop, but nothing is written. Rungs, due dates, streaks and the gaps list are untouched, so
   it is extra reps, never a shortcut to closing a gap. */
function startPractice() {
  startSession(shuffle(openGaps().map((g) => g.id)), true);
}

function currentId() {
  const s = state.session;
  if (!s) return null;
  return s.queue[0] || s.requeue[0] || null;
}

function advance() {
  const s = state.session;
  if (s.queue.length) s.queue.shift();
  else s.requeue.shift();
  state.reveal = false;
}

function answered(g) {
  const s = state.session;
  const id = currentId();
  if (!id) return;
  const onRequeue = !s.queue.length;
  if (!s.practice) grade(id, g, onRequeue);
  s.done += 1;
  const missed = g === "blank" || g === "struggled";
  if (missed) s.gaps += 1;
  if (!s.practice) logSession();

  // gap-filling loop: a miss comes back before the session closes
  if (missed) {
    if (!s.requeue.includes(id)) s.requeue.push(id);
    if (s.queue.length) {
      s.queue.shift();
      state.reveal = false;
      render();
      return;
    }
  }
  advance();
  if (!currentId()) return endSession();
  render();
}

/* "I know this": retire the word mid-session. Not a grade and not a rep, so the session
   count is untouched; the card and its partner leave the queue and the requeue loop. */
function retired() {
  const s = state.session;
  const id = currentId();
  if (!id) return;
  const { wid } = parseId(id);
  markKnown(wid);
  const gone = (x) => parseId(x).wid === wid;
  s.queue = s.queue.filter((x) => !gone(x));
  s.requeue = s.requeue.filter((x) => !gone(x));
  s.total = Math.max(s.done, s.total - 1);
  state.reveal = false;
  if (!currentId()) return endSession();
  render();
}

/* Upsert keyed on the session's own id, called after every card: a sitting abandoned
   halfway still counts, and rewriting the entry in place is what stops it counting twice.
   Two devices on one day keep separate ids, so the day's chart sums them. */
function logSession() {
  const s = state.session;
  if (!s) return;
  const rec = { id: s.sid, date: s.started, reps: s.done, gaps: s.gaps, at: stamp() };
  const list = P().sessions;
  const i = list.findIndex((x) => x.id === s.sid);
  if (i >= 0) list[i] = rec;
  else list.unshift(rec);
  P().sessions = list.slice(0, 200);
  save();
}

function endSession() {
  const s = state.session;
  if (!s.practice) logSession();
  state.session = { ...s, finished: true };
  render();
}

// ---------- render ----------

const esc = (t) =>
  String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function go(view) {
  state.view = view;
  if (state.session && state.session.finished) state.session = null;
  render();
}

/* Lit ticks step through the ramp, so the climb itself is the colour. */
function ladderHTML(rung, big) {
  return `<span class="ladder${big ? " ladder-lg" : ""}" aria-label="rung ${rung} of ${MAX_RUNG}">${RUNGS.map(
    (_, i) =>
      i < rung
        ? `<span class="tick lit" style="background:var(--r${i + 1})"></span>`
        : `<span class="tick"></span>`
  ).join("")}</span>`;
}

// ---------- speech ----------

/* Every browser ships a French voice, so hearing a card costs no files and no
   network. This replaced the IPA line on the card: it was notation Ammaar could
   not read (his call, 2026-08-27), sitting exactly where the audio belongs.
   Synthetic, so liaison and rhythm are flatter than a real speaker. */

const MUTE = "lf.mute";
let frVoice = null;

function pickVoice() {
  if (!("speechSynthesis" in window)) return null;
  const vs = speechSynthesis.getVoices();
  if (!vs.length) return null;      // Chrome populates these asynchronously
  /* macOS ships a pile of character voices — Eddy, Grandma, Rocko — and they all
     render as "Eddy (French (France))". The real system voices (Thomas, Jacques,
     Amélie) carry no bracket, so that is the whole test. Local beats network:
     it is instant and works on a plane. */
  const plain = (v) => !v.name.includes("(");
  const fr = vs.filter((v) => v.lang === "fr-FR");
  frVoice =
    fr.find((v) => plain(v) && v.localService) ||
    fr.find(plain) ||
    fr.find((v) => v.localService) ||
    fr[0] ||
    vs.find((v) => (v.lang || "").toLowerCase().startsWith("fr")) ||
    null;
  return frVoice;
}

if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.addEventListener("voiceschanged", pickVoice);
}

const canSpeak = () => "speechSynthesis" in window;
const muted = () => localStorage.getItem(MUTE) === "1";

function speak(text) {
  if (!text || !canSpeak()) return;
  try {
    speechSynthesis.cancel();       // a fast grader must not stack utterances
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "fr-FR";
    if (frVoice || pickVoice()) u.voice = frVoice;
    u.rate = 0.92;                  // just under natural: this is a model to copy
    speechSynthesis.speak(u);
  } catch (e) {
    /* speech is a nicety. It must never take a review down with it. */
  }
}

// the sentence if the card has one, else the bare word
const sayable = (w) => (w && w.ex ? w.ex.fr : w && w.fr) || "";

const SPEAKER = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.6L12 5.6v12.8L7.6 14.5H4z"/>` +
  `<path d="M15.4 9.1a4 4 0 0 1 0 5.8M18 6.6a7.5 7.5 0 0 1 0 10.8" fill="none"/></svg>`;

const sayButton = (extra) =>
  canSpeak() ? `<button class="say${extra || ""}" data-say aria-label="hear it">${SPEAKER}</button>` : "";

// ---------- charts ----------

const TARGET = "2026-12-15";

/* The three places words come from, each as done over total. */
function chartSources() {
  const rows = sources()
    .map((r) => {
      const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
      const left = r.total - r.done;
      const n = (x) => x.toLocaleString("en-GB");
      const note = left ? `${n(r.done)} ${r.verb} · ${n(left)} to go` : `all ${r.verb}`;
      return `<div class="src-row">
        <span class="src-name">${esc(r.name)}</span>
        <span class="src-total meta">${r.total.toLocaleString("en-GB")}</span>
        <span class="src-bar"><span class="src-fill" style="width:${pct}%"></span></span>
        <span class="src-note meta">${esc(note)}</span>
      </div>`;
    })
    .join("");
  return `<div class="chart-block">
    <div class="chart-head">
      <h2 class="chart-title">Where your words come from</h2>
      <span class="meta">${newPaused() ? "duolingo first" : `${INTAKE_PER_DAY} new a day`}</span>
    </div>
    <div class="sources">${rows}</div>
  </div>`;
}

/* When progress last reached the repo. On localhost there is no repo. */
function lastSaved() {
  if (LOCAL) return "local";
  const at = state.prog && state.prog.data.updatedAt;
  if (!at) return "never";
  const d = new Date(at);
  const today = iso(d) === todayISO();
  return today
    ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/* How many cards sit on each rung, 1 through 6, then a last bucket for retired cards.
   A card at rung 0 comes back in a day, so it is counted with rung 1: no "new" column
   (Ammaar, 2026-09-09). Mass moving right is the progress. */
const KNOWN_COL = MAX_RUNG;   // index in counts: rungs 1..6 sit at 0..5

function rungCounts() {
  const counts = Array(KNOWN_COL + 1).fill(0);
  for (const id of seenIds()) counts[isKnown(id) ? KNOWN_COL : Math.max(1, card(id).rung) - 1] += 1;
  return counts;
}

function chartRungs() {
  const counts = rungCounts();
  const max = Math.max(...counts, 1);
  const labels = [...RUNGS.map((d) => ivlText(d)), "known"];

  const cols = counts
    .map((n, i) => {
      const h = n ? Math.max(6, Math.round((n / max) * 112)) : 2;
      // known sits past the end of the ramp, so it wears the ink, not a violet
      const fill = i === KNOWN_COL ? "var(--ink)" : `var(--r${i + 1})`;
      const tip = `${n} ${n === 1 ? "card" : "cards"} · ${
        i === KNOWN_COL ? "retired, never comes back" : "every " + labels[i]
      }`;
      return `<div class="rung-col" data-tip="${esc(tip)}">
        <span class="rung-n${n ? " has" : ""}">${n || ""}</span>
        <span class="rung-bar" style="height:${h}px;background:${n ? fill : "var(--rule)"}"></span>
      </div>`;
    })
    .join("");

  return `<div class="chart-block">
    <div class="chart-head">
      <h2 class="chart-title">Where your words sit</h2>
      <span class="meta">colour tracks the interval</span>
    </div>
    <p class="chart-note">Every card you have answered, by how long it rests before it comes back.
      Right is better. The last column is words you retired.</p>
    <div class="rungs">${cols}</div>
    <div class="rung-axis">${labels.map((l) => `<span class="rung-lbl">${l}</span>`).join("")}</div>
  </div>`;
}

/* Reps per day for the last 8 weeks. Consistency, without counting a streak at you. */
function chartActivity() {
  const byDay = {};
  for (const ses of P().sessions) byDay[ses.date] = (byDay[ses.date] || 0) + ses.reps;

  /* Day keys are UTC throughout (iso/todayISO are UTC), so step back in UTC too.
     Parsing "T00:00:00" as local and re-serialising shifted every cell a day west. */
  const todayMs = Date.parse(todayISO() + "T00:00:00Z");
  const max = Math.max(...Object.values(byDay), 1);

  let cells = "";
  for (let i = 55; i >= 0; i--) {
    const key = iso(new Date(todayMs - i * 86400000));
    const n = byDay[key] || 0;
    const step = n ? Math.min(MAX_RUNG, Math.max(1, Math.ceil((n / max) * MAX_RUNG))) : 0;
    const h = n ? Math.max(18, Math.round((n / max) * 100)) : 12;
    const style = ` style="height:${h}%${n ? `;background:var(--r${step});border-color:transparent` : ""}"`;
    cells += `<span class="day${i === 0 ? " today" : ""}"${style} data-tip="${key} · ${n} ${
      n === 1 ? "card" : "cards"
    }"></span>`;
  }

  const total = Object.values(byDay).reduce((a, b) => a + b, 0);
  const days = Object.keys(byDay).length;
  return `<div class="chart-block">
    <div class="chart-head">
      <h2 class="chart-title">Every day you turned up</h2>
      <span class="meta">${total} ${total === 1 ? "card" : "cards"} over ${days} ${days === 1 ? "day" : "days"}</span>
    </div>
    <div class="weeks">${cells}</div>
  </div>`;
}

function viewToday() {
  const due = todaysQueue().length;
  const open = openGaps().length;
  const live = state.session && !state.session.finished;

  if (!state.words.length) {
    return `<div class="page">
      <h1 class="page-title">No words yet</h1>
      <p class="lede">Add words from the terminal, then reload.</p>
      <p class="hint"><code>python3 tool/add.py "le chien = the dog"</code></p>
    </div>`;
  }

  const mature = state.words.filter((w) => wordIsMature(w.id)).length;
  const daysLeft = daysUntil(TARGET);

  return `<div class="page">
    <div class="chart-head" style="padding-bottom:0">
      <p class="meta">${esc(new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }))}</p>
      <p class="deadline">${daysLeft} days to NCLC 7</p>
    </div>
    <div class="count">
      <span class="count-n">${due}</span>
      <span class="meta">${due === 1 ? "card due" : "cards due"}</span>
    </div>
    <p class="lede">${due ? `About ${Math.max(1, Math.round((due * 12) / 60))} min.` : "Nothing due."}</p>
    ${
      live
        ? `<button class="start" data-go="review">Resume review</button>
           <p class="hint">${state.session.queue.length + state.session.requeue.length} cards still open in this session${
             state.session.requeue.length ? `, ${state.session.requeue.length} requeued` : ""
           }.</p>`
        : `<button class="start" data-start ${due ? "" : "disabled"}>${due ? "Begin review" : "Nothing to review"}</button>`
    }

    ${chartSources()}
    ${chartRungs()}
    ${chartActivity()}

    <div class="stats">
      <div>
        <div class="stat-n">${esc(lastSaved())}</div>
        <div class="stat-l meta">last saved</div>
      </div>
      <div>
        <div class="stat-n is-deep">${mature}</div>
        <div class="stat-l meta">${mature === 1 ? "word tested both ways" : "words tested both ways"}</div>
      </div>
      <div>
        <div class="stat-n${open ? " is-gap" : ""}">${open}</div>
        <div class="stat-l meta">${open === 1 ? "open gap" : "open gaps"}</div>
      </div>
    </div>
  </div>`;
}

function viewReview() {
  const s = state.session;
  if (!s) return viewToday();

  if (s.finished && s.practice) {
    return `<div class="page">
      <h1 class="page-title">Practice closed</h1>
      <div class="summary-block">
        <div class="summary-n">${s.done}</div>
        <p class="meta">${s.done === 1 ? "card answered" : "cards answered"}</p>
      </div>
      <div class="summary-block">
        <div class="summary-n${s.gaps ? " is-gap" : ""}">${s.gaps}</div>
        <p class="meta">${s.gaps === 1 ? "miss" : "misses"}</p>
      </div>
      <p class="lede">Practice only: nothing moved on the ladder. A gap closes when its card
        passes its next ${GAP_CLOSES_AT} scheduled reviews in a row.</p>
      <button class="start" data-go="gaps">Back to gaps</button>
    </div>`;
  }

  if (s.finished) {
    const more = todaysQueue().length;
    return `<div class="page">
      <h1 class="page-title">Session closed</h1>
      <div class="summary-block">
        <div class="summary-n">${s.done}</div>
        <p class="meta">${s.done === 1 ? "card answered" : "cards answered"}</p>
      </div>
      <div class="summary-block">
        <div class="summary-n${s.gaps ? " is-gap" : ""}">${s.gaps}</div>
        <p class="meta">${s.gaps === 1 ? "gap found" : "gaps found"}</p>
      </div>
      <p class="lede">${
        s.gaps
          ? "Every gap came back before the session closed. They are logged under gaps."
          : "Nothing missed. Those cards moved up the ladder."
      }</p>
      ${
        more
          ? `<button class="start" data-start>Another ${more} ${more === 1 ? "card" : "cards"}</button>
             <p class="hint">The daily pace is a floor. Keep going as long as you want to.</p>
             <button class="start ghost" data-go="today">Back to today</button>`
          : `<button class="start" data-go="today">Back to today</button>`
      }
    </div>`;
  }

  const id = currentId();
  const w = wordOf(id);
  const { dir } = parseId(id);
  const c = card(id);
  const left = s.queue.length + s.requeue.length;

  const label = (s.practice ? "practice · " : "") + (dir === "r" ? "input · french to english" : "output · english to french");
  const ex = w.ex;

  /* Input shows the pronunciation with the french prompt: it is a cue for saying
     the word, not the answer. Output hides it until reveal, where it belongs to
     the french the card was asking for. */
  const glossLine = `<p class="gloss"><span class="gloss-fr">${esc(w.fr)}</span>${
    w.pos ? `<span class="gloss-pos">${esc(w.pos)}</span>` : ""
  }<span class="gloss-en">${esc(w.en)}</span></p>`;

  /* The card is the sentence, not the word. A bare gloss is unlearnable for the
     words that dominate the early list — "de", "ça", "y" have no stable English
     translation to memorise, only a use. The target is marked rather than blanked
     so the sentence still reads as French while the eye knows where to land. */
  const marked = ex
    ? esc(ex.fr.slice(0, ex.hl[0])) +
      `<b class="target">${esc(ex.fr.slice(ex.hl[0], ex.hl[1]))}</b>` +
      esc(ex.fr.slice(ex.hl[1]))
    : "";

  let prompt, sub, slot;
  if (dir === "r") {
    prompt = ex ? `<h1 class="phrase">${marked}</h1>` : `<h1 class="headword">${esc(w.fr)}</h1>`;
    sub = `${w.pos && !ex ? `<p class="pos">${esc(w.pos)}</p>` : ""}${sayButton()}`;
    slot = state.reveal
      ? ex
        ? `<div><p class="phrase-en">${esc(ex.en)}</p>${glossLine}</div>`
        : `<div><p class="definition">${esc(w.en)}</p></div>`
      : `<span class="slot-rule"></span>`;
  } else {
    prompt = `<h1 class="headword">${esc(w.en)}</h1>`;
    sub = ex ? `<p class="phrase-en cue">${esc(ex.en)}</p>` : "";
    slot = state.reveal
      ? `<div>${ex ? `<p class="phrase">${marked}</p>` : `<p class="definition">${esc(w.fr)}</p>`}${sayButton()}</div>`
      : `<span class="slot-rule"></span>`;
  }

  const controls = state.reveal
    ? `<div class="grades${s.practice ? " practice" : ""}">${GRADES.map((g) => {
        // the interval wears the colour the card is about to become
        const next = rungAfter(c.rung, g.key);
        const tint = g.gap ? "var(--gap)" : `var(--r${next})`;
        return `<button class="grade${g.gap ? " is-gap" : ""}" data-grade="${g.key}">
          <span class="grade-name">${g.name}</span>
          <span class="grade-ivl">${ivlText(previewDays(id, g.key))}</span>
          <span class="grade-chip" style="background:${tint}"></span>
        </button>`;
      }).join("")}</div>
      <button class="retire" data-retire>I know this, retire it</button>
      <p class="meta dim keys">1 &nbsp;2 &nbsp;3 &nbsp;4 to grade &nbsp;·&nbsp; 5 retires</p>`
    : `<button class="reveal" data-reveal>Reveal</button>
       <p class="meta dim keys">space to reveal</p>`;

  return `<div class="review">
    <div class="progress">
      ${ladderHTML(c.rung)}
      <span class="meta">${left} left${s.requeue.length ? ` · ${s.requeue.length} requeued` : ""}</span>
    </div>
    <div class="entry">
      <p class="direction">${label}</p>
      ${prompt}
      ${sub}
      <div class="slot">${slot}</div>
      ${state.reveal && w.note ? `<p class="note">${esc(w.note)}</p>` : ""}
    </div>
    ${controls}
  </div>`;
}

function viewGate(msg) {
  return `<div class="page gate">
    <h1 class="page-title">français</h1>
    <p class="lede">Vocabulary on a spaced ladder. This device needs the key to reach your progress.</p>
    ${msg ? `<p class="gate-msg">${esc(msg)}</p>` : ""}
    <label class="meta" for="gate-token">key</label>
    <input type="password" id="gate-token" placeholder="github_pat_…" autocomplete="off" />
    <button class="start" id="gate-go">Unlock</button>
    <p class="hint">A fine-grained GitHub token with <code>Contents: Read and write</code> on
    <code>learn-french-data</code>. It is stored in this browser only.</p>
  </div>`;
}

function viewGaps() {
  const gaps = openGaps();
  return `<div class="page">
    <h1 class="page-title">Gaps</h1>
    <p class="lede">Every word you drew a blank on or struggled with and have not yet put right.
      This is the score. There is no other one. A gap closes once its card passes its next
      ${GAP_CLOSES_AT} scheduled reviews in a row.</p>
    ${
      gaps.length
        ? `<button class="start" data-practice>Practise these ${gaps.length}</button>
           <p class="hint">Same cards, same grades, nothing written: the ladder does not move.</p>`
        : ""
    }
    ${
      gaps.length
        ? gaps
            .map(
              (g) => `<div class="row">
        <span class="row-main"><span class="gap-word">${esc(g.fr)}</span> <span class="row-en">${esc(g.en)}</span></span>
        <span class="row-side meta">${g.dir === "p" ? "en→fr · " : ""}${esc(g.grade)} · ${esc(g.at.slice(0, 10))}${
          g.n > 1 ? ` · ×${g.n}` : ""
        }</span>
      </div>`
            )
            .join("")
        : `<p class="empty">No open gaps.</p>`
    }
  </div>`;
}

function viewWords() {
  const rows = state.words
    .map((w) => {
      const r = card("r:" + w.id);
      const mature = wordIsMature(w.id);
      const known = wordIsKnown(w.id);
      return `<div class="row">
      <span class="row-main"><span class="row-fr">${esc(w.fr)}</span>${
        w.ipa ? ` <span class="row-ipa">${esc(w.ipa)}</span>` : ""
      } <span class="row-en">${esc(w.en)}</span></span>
      <span class="row-side">
        ${ladderHTML(r.rung, true)}
        <div class="meta dim" style="margin-top:5px">${known ? "known" : esc(whenText(r.due)) + (mature ? " · both ways" : "")}</div>
      </span>
    </div>`;
    })
    .join("");

  const shown = state.words.filter((w) => seen("r:" + w.id)).length;
  return `<div class="page">
    <h1 class="page-title">Words</h1>
    <p class="lede">${shown} words seen so far. A word gets its english to french card once it
    reaches the 8-day rung.</p>
    ${
      newPaused()
        ? `<p class="hint">Duolingo words first. New words start ${NEW_PAUSE_UNTIL}, ${INTAKE_PER_DAY} a day.</p>`
        : `<p class="hint">${INTAKE_PER_DAY} new words a day.</p>`
    }
    ${rows || `<p class="empty">No words yet.</p>`}
    <p class="hint" style="margin-top:2rem">Add more by hand: <code>python3 web/add.py "le chien = the dog"</code></p>
  </div>`;
}

function render(gateMsg) {
  const main = document.getElementById("main");
  const nav = document.querySelector(".tabs");
  const warn = document.getElementById("write-warning");

  const mute = document.getElementById("mute-btn");
  if (mute) {
    mute.hidden = !canSpeak();
    mute.classList.toggle("off", muted());
    mute.innerHTML = SPEAKER;
    // the button governs auto-play only: tapping the speaker on a card always speaks
    mute.title = muted() ? "speaks on reveal: off" : "speaks on reveal: on";
  }

  if (!LOCAL && !state.token) {
    nav.hidden = true;
    warn.hidden = true;
    main.innerHTML = viewGate(gateMsg);
    const go = () => {
      const t = document.getElementById("gate-token").value.trim();
      if (!t) return;
      state.token = t;
      localStorage.setItem(LS.token, t);
      render();
      refreshRemote();
    };
    document.getElementById("gate-go").onclick = go;
    document.getElementById("gate-token").onkeydown = (e) => {
      if (e.key === "Enter") go();
    };
    return;
  }

  nav.hidden = false;
  warn.hidden = !state.writeError;
  warn.textContent = state.writeError || "";

  const views = { today: viewToday, review: viewReview, gaps: viewGaps, words: viewWords };
  main.innerHTML = (views[state.view] || viewToday)();
  document.querySelectorAll(".tabs button").forEach((b) => {
    b.classList.toggle("on", b.dataset.go === state.view || (state.view === "review" && b.dataset.go === "today"));
  });
  setSync(state.sync);
}

// ---------- tooltip ----------

function tipEl() {
  let el = document.getElementById("tip");
  if (!el) {
    el = document.createElement("div");
    el.id = "tip";
    document.body.appendChild(el);
  }
  return el;
}

document.addEventListener("mouseover", (e) => {
  const t = e.target.closest("[data-tip]");
  const el = tipEl();
  if (!t) return el.classList.remove("show");
  el.textContent = t.dataset.tip;
  const r = t.getBoundingClientRect();
  el.style.left = r.left + r.width / 2 + "px";
  el.style.top = r.top + "px";
  el.classList.add("show");
});

document.addEventListener("mouseout", (e) => {
  if (!e.relatedTarget || !e.relatedTarget.closest("[data-tip]")) {
    document.getElementById("tip")?.classList.remove("show");
  }
});

/* Reveal is the moment the french is settled, so it is the moment to hear it.
   It always runs off a tap or a keypress, which is what iOS requires before it
   will let a page speak at all. */
function reveal() {
  state.reveal = true;
  render();
  if (!muted()) speak(sayable(wordOf(currentId())));
}

// ---------- events ----------

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-go], [data-start], [data-practice], [data-reveal], [data-grade], [data-retire], [data-say], [data-mute]");
  if (!t) return;
  e.preventDefault();
  if (t.dataset.say !== undefined) return speak(sayable(wordOf(currentId())));
  if (t.dataset.mute !== undefined) {
    localStorage.setItem(MUTE, muted() ? "0" : "1");
    if (muted()) speechSynthesis.cancel();
    return render();
  }
  if (t.dataset.go) return go(t.dataset.go);
  if (t.dataset.start !== undefined) return startSession();
  if (t.dataset.practice !== undefined) return startPractice();
  if (t.dataset.reveal !== undefined) return reveal();
  if (t.dataset.grade) return answered(t.dataset.grade);
  if (t.dataset.retire !== undefined) return retired();
});

document.addEventListener("keydown", (e) => {
  if (state.view !== "review" || !state.session || state.session.finished) return;
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    if (!state.reveal) reveal();
    return;
  }
  if (state.reveal && ["1", "2", "3", "4"].includes(e.key)) {
    e.preventDefault();
    answered(GRADES[Number(e.key) - 1].key);
  }
  if (state.reveal && e.key === "5") {
    e.preventDefault();
    retired();
  }
});

// ---------- boot ----------

(async function boot() {
  const local = loadProgLocal();
  state.prog = local && local.data ? local : { data: local || emptyProgress(), sha: null, dirty: false };

  try {
    const res = await fetch("vocab.json?t=" + Date.now(), { cache: "no-store" });
    state.words = (await res.json()).words || [];
  } catch (e) {
    state.words = [];
  }
  state.own = state.words.length;

  try {
    const res = await fetch("frequency-3000.json?t=" + Date.now(), { cache: "no-store" });
    state.rawPool = (await res.json()).words || [];
    state.words = state.words.concat(intake(state.rawPool));
  } catch (e) {
    /* the app still works on vocab.json alone */
  }
  render();
  refreshRemote();

  // another device may have reviewed since this tab was opened
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !state.session) refreshRemote();
  });
  window.addEventListener("beforeunload", () => {
    if (state.prog && state.prog.dirty) pushProgress();
  });
})();
