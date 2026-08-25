/* français — SIR ladder vocabulary trainer.
   Scheduling is the ladder from ~/Desktop/projects/quran-translation, see ../resources/ladder.md.
   No streaks, no points. The gaps list is the score. */

// ---------- constants ----------

// interval ladder in days. rung 0 = never passed. rung n -> RUNGS[n-1] days.
const RUNGS = [1, 3, 8, 18, 40, 90];
const MAX_RUNG = RUNGS.length;

// a word's production card unlocks once its recognition card reaches this rung
const MATURE_RUNG = 3;

/* Frequency intake. frequency-3000.json holds the 3,000 most frequent French lemmas
   (Lexique 3.83 + Wiktionary, see build_pool.py). Words enter the ladder on a drip:
   INTAKE_PER_DAY of them per calendar day since INTAKE_START.

   Promotion is a pure function of the date, not a stored counter, so every device
   computes the same answer and there is nothing to merge or drift. The session cap
   below, not the promotion, is what keeps a day's work finite. */
const INTAKE_START = "2026-08-25";
const INTAKE_PER_DAY = 20;

// a session takes every due review, but only this many cards never seen before
const NEW_PER_SESSION = 20;

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

const b64encode = (t) => btoa(String.fromCharCode(...new TextEncoder().encode(t)));
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
  ).slice(0, 200);
  out.sessions = dedupe(
    [...(a.sessions || []), ...(b.sessions || [])].sort((x, y) =>
      (y.at || "").localeCompare(x.at || "")
    ),
    (x) => x.at
  ).slice(0, 200);
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

async function pushProgress() {
  if (LOCAL || !state.token || !state.prog || !state.prog.dirty) return;
  setSync("syncing");
  try {
    state.prog.data.updatedAt = stamp();
    const sha = await ghPut("progress.json", state.prog.data, state.prog.sha, `progress · ${stamp()}`);
    state.prog.sha = sha;
    state.prog.dirty = false;
    saveProgLocal();
    setSync("idle");
    if (state.writeError) {
      state.writeError = null;
      render();
    }
  } catch (e) {
    if (e.status === 409 || e.status === 422) {
      try {
        const remote = await ghGet("progress.json");
        state.prog.data = mergeProgress(state.prog.data, remote.data);
        state.prog.sha = remote.sha;
        state.prog.sha = await ghPut(
          "progress.json",
          state.prog.data,
          state.prog.sha,
          `progress merge · ${stamp()}`
        );
        state.prog.dirty = false;
        saveProgLocal();
        setSync("idle");
        render();
      } catch (e2) {
        setSync("error");
        failWrite(e2);
      }
    } else if (e.status === 401 || e.status === 403 || e.status === 404) {
      /* Never treat this as offline. Offline retries forever, looks fine, and silently keeps
         every review in this one browser. */
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
      : "Could not save to the repo. Your work is still in this browser.";
  render();
}

// ---------- intake ----------

/* How many frequency words are in play today. Pure function of the date: no counter,
   so two devices never disagree and a rebuilt pool cannot shift what you have seen. */
function intakeCount() {
  const days = -daysUntil(INTAKE_START); // days since the start, 0 on the first day
  if (days < 0) return 0;
  return (days + 1) * INTAKE_PER_DAY;
}

/* ids are keyed on the word itself ("f-chien"), not on rank, so re-ranking the pool
   later cannot detach a card from its history. */
function intake(pool) {
  state.poolTotal = pool.length;
  const mine = new Set(state.words.map((w) => w.fr.toLowerCase()));
  const taken = [];
  for (const p of pool) {
    if (taken.length >= intakeCount()) break;
    if (mine.has(p.fr.toLowerCase())) continue; // already collected by hand
    taken.push({ id: "f-" + p.fr, fr: p.fr, pos: p.pos, en: p.en, ipa: p.ipa, note: p.note || "" });
  }
  state.pool = taken.length;
  return taken;
}

// ---------- cards ----------
// id shape: "r:w001" recognition (fr -> en), "p:w001" production (en -> fr)

const parseId = (id) => ({ dir: id.slice(0, 1), wid: id.slice(2) });
const wordOf = (id) => state.words.find((w) => w.id === parseId(id).wid);

function card(id) {
  return P().cards[id] || { rung: 0, due: todayISO(), reps: 0, lapses: 0 };
}

function wordIsMature(wid) {
  return card("r:" + wid).rung >= MATURE_RUNG;
}

/* Early stage: recognition only. Production unlocks at the maturity flip, which is
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
  return activeIds().filter((id) => card(id).due <= t);
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

function grade(id, g) {
  const c = { ...card(id) };
  c.reps += 1;
  if (g === "blank" || g === "struggled") c.lapses += 1;
  c.rung = rungAfter(c.rung, g);
  c.due = iso(addDays(new Date(), daysForRung(c.rung)));
  c.updatedAt = stamp();
  P().cards[id] = c;

  if (g === "blank" || g === "struggled") {
    const w = wordOf(id);
    P().gaps.unshift({ id, fr: w.fr, en: w.en, dir: parseId(id).dir, grade: g, at: stamp() });
    P().gaps = P().gaps.slice(0, 200);
  }
  save();
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
  const fresh = due.filter(isFresh).slice(0, NEW_PER_SESSION);
  return due.filter((id) => !isFresh(id)).concat(fresh);
}

/* Early stage keeps a fixed order and one card type; once any word has matured the
   queue mixes order and type. Volume, order, type: the three SIR variables. */
function buildQueue() {
  const ids = todaysQueue();
  return anyMature() ? shuffle(ids) : ids;
}

/* Promoted but not yet reached, because of the new-card cap. */
function waitingCount() {
  return Math.max(0, dueIds().filter(isFresh).length - NEW_PER_SESSION);
}

function startSession() {
  const queue = buildQueue();
  if (!queue.length) return;
  state.session = {
    queue,
    requeue: [],
    total: queue.length,
    done: 0,
    gaps: 0,
    started: todayISO(),
  };
  state.reveal = false;
  go("review");
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
  grade(id, g);
  s.done += 1;

  // gap-filling loop: a miss comes back before the session closes
  if (g === "blank" || g === "struggled") {
    s.gaps += 1;
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

function endSession() {
  const s = state.session;
  P().sessions.unshift({ date: s.started, reps: s.done, gaps: s.gaps, at: stamp() });
  P().sessions = P().sessions.slice(0, 200);
  save();
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

// ---------- charts ----------

const TARGET = "2026-12-15";

/* How many cards sit on each rung, 0 through 6. Mass moving right is the progress. */
function rungCounts() {
  const counts = Array(MAX_RUNG + 1).fill(0);
  for (const id of activeIds()) counts[card(id).rung] += 1;
  return counts;
}

function chartRungs() {
  const counts = rungCounts();
  const max = Math.max(...counts, 1);
  const labels = ["new", ...RUNGS.map((d) => ivlText(d))];

  const cols = counts
    .map((n, i) => {
      const h = n ? Math.max(6, Math.round((n / max) * 112)) : 2;
      const fill = `var(--r${i})`;
      const tip = `${n} ${n === 1 ? "card" : "cards"} · ${i === 0 ? "not passed yet" : "every " + labels[i]}`;
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
    <div class="rungs">${cols}</div>
    <div class="rung-axis">${labels.map((l) => `<span class="rung-lbl">${l}</span>`).join("")}</div>
  </div>`;
}

/* Reps per day for the last 8 weeks. Consistency, without counting a streak at you. */
function chartActivity() {
  const byDay = {};
  for (const ses of P().sessions) byDay[ses.date] = (byDay[ses.date] || 0) + ses.reps;

  const today = new Date(todayISO() + "T00:00:00");
  const max = Math.max(...Object.values(byDay), 1);

  let cells = "";
  for (let i = 55; i >= 0; i--) {
    const day = addDays(today, -i);
    const key = iso(day);
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
  const total = activeIds().length;
  const waiting = waitingCount();
  const openGaps = P().gaps.length;
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
    <p class="lede">${
      due
        ? `About ${Math.max(1, Math.round((due * 12) / 60))} min. ${total} cards in rotation across ${state.words.length} words.`
        : `Nothing due. ${total} cards in rotation across ${state.words.length} words.`
    }${waiting ? ` ${waiting} more waiting behind today's ${NEW_PER_SESSION} new.` : ""}</p>
    ${
      live
        ? `<button class="start" data-go="review">Resume review</button>
           <p class="hint">${state.session.queue.length + state.session.requeue.length} cards still open in this session${
             state.session.requeue.length ? `, ${state.session.requeue.length} requeued` : ""
           }.</p>`
        : `<button class="start" data-start ${due ? "" : "disabled"}>${due ? "Begin review" : "Nothing to review"}</button>`
    }

    ${chartRungs()}
    ${chartActivity()}

    <div class="stats">
      <div>
        <div class="stat-n is-deep">${mature}</div>
        <div class="stat-l meta">${mature === 1 ? "word known both ways" : "words known both ways"}</div>
      </div>
      <div>
        <div class="stat-n">${state.words.length}</div>
        <div class="stat-l meta">words in play</div>
      </div>
      <div>
        <div class="stat-n${openGaps ? " is-gap" : ""}">${openGaps}</div>
        <div class="stat-l meta">${openGaps === 1 ? "gap logged" : "gaps logged"}</div>
      </div>
    </div>
  </div>`;
}

function viewReview() {
  const s = state.session;
  if (!s) return viewToday();

  if (s.finished) {
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
      <button class="start" data-go="today">Back to today</button>
    </div>`;
  }

  const id = currentId();
  const w = wordOf(id);
  const { dir } = parseId(id);
  const c = card(id);
  const left = s.queue.length + s.requeue.length;

  const prompt = dir === "r" ? w.fr : w.en;
  const answer = dir === "r" ? w.en : w.fr;
  const label = dir === "r" ? "recognise · french to english" : "produce · english to french";

  /* Recognition shows the pronunciation with the french prompt: it is a cue for saying
     the word, not the answer. Production hides it until reveal, where it belongs to
     the french the card was asking for. */
  const ipaLine = w.ipa ? `<p class="ipa">${esc(w.ipa)}</p>` : "";

  const slot = state.reveal
    ? `<div><p class="definition">${esc(answer)}</p>${dir === "p" ? ipaLine : ""}</div>`
    : `<span class="slot-rule"></span>`;

  const controls = state.reveal
    ? `<div class="grades">${GRADES.map((g) => {
        // the interval wears the colour the card is about to become
        const next = rungAfter(c.rung, g.key);
        const tint = g.gap ? "var(--gap)" : `var(--r${next})`;
        return `<button class="grade${g.gap ? " is-gap" : ""}" data-grade="${g.key}">
          <span class="grade-name">${g.name}</span>
          <span class="grade-ivl">${ivlText(previewDays(id, g.key))}</span>
          <span class="grade-chip" style="background:${tint}"></span>
        </button>`;
      }).join("")}</div>
      <p class="meta dim keys">1 &nbsp;2 &nbsp;3 &nbsp;4 to grade</p>`
    : `<button class="reveal" data-reveal>Reveal</button>
       <p class="meta dim keys">space to reveal</p>`;

  return `<div class="review">
    <div class="progress">
      ${ladderHTML(c.rung)}
      <span class="meta">${left} left${s.requeue.length ? ` · ${s.requeue.length} requeued` : ""}</span>
    </div>
    <div class="entry">
      <p class="direction">${label}</p>
      <h1 class="headword">${esc(prompt)}</h1>
      ${dir === "r" ? `${w.pos ? `<p class="pos">${esc(w.pos)}</p>` : ""}${ipaLine}` : ""}
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
  const gaps = P().gaps;
  return `<div class="page">
    <h1 class="page-title">Gaps</h1>
    <p class="lede">Every word you drew a blank on or struggled with. This is the score. There is no other one.</p>
    ${
      gaps.length
        ? gaps
            .map(
              (g) => `<div class="row">
        <span class="row-main"><span class="gap-word">${esc(g.fr)}</span> <span class="row-en">${esc(g.en)}</span></span>
        <span class="row-side meta">${esc(g.grade)} · ${esc(g.at.slice(0, 10))}</span>
      </div>`
            )
            .join("")
        : `<p class="empty">No gaps logged yet.</p>`
    }
  </div>`;
}

function viewWords() {
  const rows = state.words
    .map((w) => {
      const r = card("r:" + w.id);
      const mature = wordIsMature(w.id);
      return `<div class="row">
      <span class="row-main"><span class="row-fr">${esc(w.fr)}</span>${
        w.ipa ? ` <span class="row-ipa">${esc(w.ipa)}</span>` : ""
      } <span class="row-en">${esc(w.en)}</span></span>
      <span class="row-side">
        ${ladderHTML(r.rung, true)}
        <div class="meta dim" style="margin-top:5px">${esc(whenText(r.due))}${mature ? " · both ways" : ""}</div>
      </span>
    </div>`;
    })
    .join("");

  const left = state.poolTotal - state.pool;
  return `<div class="page">
    <h1 class="page-title">Words</h1>
    <p class="lede">${state.words.length} words: ${state.own} collected by hand, ${state.pool} from
    the frequency list. A word gains its english to french card once it reaches rung ${MATURE_RUNG}.</p>
    ${
      left > 0
        ? `<p class="hint">${INTAKE_PER_DAY} more arrive each day. ${left} left in the list of
           ${state.poolTotal}, so the last one lands ${esc(
             iso(addDays(new Date(), Math.ceil(left / INTAKE_PER_DAY)))
           )}.</p>`
        : ""
    }
    ${rows || `<p class="empty">No words yet.</p>`}
    <p class="hint" style="margin-top:2rem">Add more by hand: <code>python3 web/add.py "le chien = the dog"</code></p>
  </div>`;
}

function render(gateMsg) {
  const main = document.getElementById("main");
  const nav = document.querySelector(".tabs");
  const warn = document.getElementById("write-warning");

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

// ---------- events ----------

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-go], [data-start], [data-reveal], [data-grade]");
  if (!t) return;
  e.preventDefault();
  if (t.dataset.go) return go(t.dataset.go);
  if (t.dataset.start !== undefined) return startSession();
  if (t.dataset.reveal !== undefined) {
    state.reveal = true;
    return render();
  }
  if (t.dataset.grade) return answered(t.dataset.grade);
});

document.addEventListener("keydown", (e) => {
  if (state.view !== "review" || !state.session || state.session.finished) return;
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    if (!state.reveal) {
      state.reveal = true;
      render();
    }
    return;
  }
  if (state.reveal && ["1", "2", "3", "4"].includes(e.key)) {
    e.preventDefault();
    answered(GRADES[Number(e.key) - 1].key);
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
    state.words = state.words.concat(intake((await res.json()).words || []));
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
