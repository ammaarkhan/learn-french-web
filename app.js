/* français — SIR ladder vocabulary trainer.
   Scheduling is the ladder from ~/Desktop/projects/quran-translation, see ../resources/ladder.md.
   No streaks, no points. The gaps list is the score. */

// ---------- constants ----------

// interval ladder in days. rung 0 = never passed. rung n -> RUNGS[n-1] days.
const RUNGS = [1, 3, 8, 18, 40, 90];
const MAX_RUNG = RUNGS.length;

// a word's production card unlocks once its recognition card reaches this rung
const MATURE_RUNG = 3;

const LS_KEY = "lf.progress.v1";

const GRADES = [
  { key: "blank", name: "blank", gap: true },
  { key: "struggled", name: "struggled", gap: true },
  { key: "got", name: "got", gap: false },
  { key: "fluent", name: "fluent", gap: false },
];

// ---------- state ----------

const state = {
  words: [],
  prog: null,
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
  return { version: 1, cards: {}, gaps: [], sessions: [] };
}

const P = () => state.prog;

function loadProgress() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    state.prog = raw ? JSON.parse(raw) : emptyProgress();
  } catch (e) {
    state.prog = emptyProgress();
  }
  for (const k of ["cards", "gaps", "sessions"]) {
    if (!state.prog[k]) state.prog[k] = k === "cards" ? {} : [];
  }
}

function save() {
  localStorage.setItem(LS_KEY, JSON.stringify(state.prog));
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

/* Early stage keeps a fixed order and one card type; once any word has matured the
   queue mixes order and type. Volume, order, type: the three SIR variables. */
function buildQueue() {
  const ids = dueIds();
  return anyMature() ? shuffle(ids) : ids;
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
  const due = dueIds().length;
  const total = activeIds().length;
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
    }</p>
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
        <div class="stat-l meta">words collected</div>
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

  const slot = state.reveal
    ? `<p class="definition">${esc(answer)}</p>`
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
      ${dir === "r" && w.pos ? `<p class="pos">${esc(w.pos)}</p>` : ""}
      <div class="slot">${slot}</div>
      ${state.reveal && w.note ? `<p class="note">${esc(w.note)}</p>` : ""}
    </div>
    ${controls}
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
      <span class="row-main"><span class="row-fr">${esc(w.fr)}</span> <span class="row-en">${esc(w.en)}</span></span>
      <span class="row-side">
        ${ladderHTML(r.rung, true)}
        <div class="meta dim" style="margin-top:5px">${esc(whenText(r.due))}${mature ? " · both ways" : ""}</div>
      </span>
    </div>`;
    })
    .join("");

  return `<div class="page">
    <h1 class="page-title">Words</h1>
    <p class="lede">${state.words.length} words. A word gains its english to french card once it reaches rung ${MATURE_RUNG}.</p>
    ${rows || `<p class="empty">No words yet.</p>`}
    <p class="hint" style="margin-top:2rem">Add more: <code>python3 tool/add.py "le chien = the dog"</code></p>
  </div>`;
}

function render() {
  const main = document.getElementById("main");
  const views = { today: viewToday, review: viewReview, gaps: viewGaps, words: viewWords };
  main.innerHTML = (views[state.view] || viewToday)();
  document.querySelectorAll(".tabs button").forEach((b) => {
    b.classList.toggle("on", b.dataset.go === state.view || (state.view === "review" && b.dataset.go === "today"));
  });
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
  loadProgress();
  try {
    const res = await fetch("vocab.json?t=" + Date.now());
    const data = await res.json();
    state.words = data.words || [];
  } catch (e) {
    state.words = [];
  }
  render();
})();
