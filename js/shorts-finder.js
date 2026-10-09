"use strict";
/* ================= Shorts Finder tab =================
   One tab for the whole Shorts job: find the stretches of a finished video that stand on
   their own, then build the Google Flow prompts for the one I pick. It used to be two
   tabs and two pastes of the same script; now Transcript.srt is the only thing I hand it.

   Why the SRT is the single input: it carries the words AND the timing. Everything that
   used to be a decision falls out of it — how long a candidate runs, where it sits in the
   video, how many Flow clips it needs and how long each one is. The old MG tab asked me
   to pick 10s / 9s / 8s / 7s per clip; that pick is now measured, not guessed.

   Three translations happen here, in order:

     cues -> UNITS      a subtitle cue is half a sentence, so cues are merged into
                        speakable units of about 2.5-4s that break on punctuation. Those
                        are what gets numbered for Claude, and later what becomes one
                        motion-graphics scene each.
     units -> SHORTS    Claude answers with line numbers only, never text. The app pulls
                        the lines back out of the transcript, so what is on screen is
                        verbatim and the runtime is real.
     short -> CLIPS     a Short is split into Flow-sized clips (<=10s) by a balanced
                        partition, so four clips come out 9/9/9/9 rather than 10/10/10/6.

   Nothing here calls an API: both prompts are built in the browser for the Claude app.

   Relies on globals from script.js: $, copyText, toast, esc — and on js/mg-engine.js
   for everything motion-graphics. */
(function () {

const KEY = "shortsFinder.v2";

// ---- how cues become speakable units -------------------------------------------------
// A unit wants to be one motion-graphics scene, and the Project instructions say no scene
// may be under 2.5s and the look changes every 2.5-3.5s. So: close a unit at a sentence
// end once it is long enough, settle for a comma if it runs on, and force a break before
// it gets long enough to be two scenes.
const UNIT_MIN_SENTENCE = 2.2;   // close on . ! ? from here
const UNIT_MIN_CLAUSE = 3.0;     // close on , ; : — from here
const UNIT_MAX = 4.2;            // never grow a unit past this...
const UNIT_MIN = 2.0;            // ...unless breaking would leave a stub shorter than this

// ---- how a Short becomes Flow clips --------------------------------------------------
const CLIP_MAX = 10.0;           // Flow renders 8s or 10s, so this is the ceiling
const CLIP_MIN = 6.0;            // under this, most of a rendered 8s clip is thrown away
const CLIP_IDEAL = 8.0;          // ...and here a clip costs nothing it does not use
const CLIP_TARGETS = [2, 3, 4];
const DEFAULT_CLIPS = 2;
const DEFAULT_CHAR = "own";

/* How long a Short may run, given that it is built out of exactly `n` Flow clips. This is
   the whole length rule now. There is no separate idea of a good Short length any more,
   because a Short I cannot build is not a candidate however well it reads - and the old
   15-45s window quietly allowed both. */
function clipWindow(n) {
  return { n: n, min: n * CLIP_MIN, max: n * CLIP_MAX, ideal: n * CLIP_IDEAL };
}

const els = {
  tab:        $("tab-shorts"),
  srtFile:    $("shSrtFile"),
  srtMeta:    $("shSrtMeta"),
  srtClear:   $("shSrtClear"),
  drop:       $("shDrop"),
  clipSeg:    document.querySelectorAll("#tab-shorts .sh-clipseg input"),
  clipTargetMeta: $("shClipMetaTarget"),
  dropName:   $("shDropName"),
  dropHint:   $("shDropHint"),
  buildBtn:   $("shBuildBtn"),
  promptWrap: $("shPromptWrap"),
  promptOut:  $("shPromptOut"),
  promptCopy: $("shPromptCopy"),
  reply:      $("shReply"),
  status:     $("shReplyStatus"),
  list:       $("shList"),
  lineWrap:   $("shLinesWrap"),
  lineBox:    $("shLines"),
  // the clip half
  work:       $("shWork"),
  workTitle:  $("shWorkTitle"),
  workClose:  $("shWorkClose"),
  clips:      $("mgVideos"),
  clipTpl:    $("mgVideoTpl"),
  promptTpl:  $("mgPromptTpl"),
  fewer:      $("shFewer"),
  more:       $("shMore"),
  clipMeta:   $("shClipMeta"),
  request:    $("mgRequest"),
  copyReq:    $("mgCopyRequest"),
  reqStatus:  $("mgRequestStatus"),
  mgReply:    $("mgReply"),
  mgStatus:   $("mgReplyStatus"),
  prompts:    $("mgPrompts"),
  setupStatus: $("mgSetupStatus"),
};

let srtText = "";       // raw Transcript.srt
let srtName = "";       // ...and what it was called, for the picker to show back
let units = [];         // [{ text, start, end }] — the numbered lines everything refers to
let shorts = [];        // [{ n, from, to, score, label, type, hook, why }]  1-based, inclusive
let clipTarget = DEFAULT_CLIPS;   // how many Flow clips I want each Short built from
let sel = null;         // the Short whose clips are open, by its n
let work = {};          // per Short n: { chars, texts, clipCount, reply }

/* ---------------- transcript -> units ---------------- */

const TIME_RE = /(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;

function hms(m, i) {
  return +m[i] * 3600 + +m[i + 1] * 60 + +m[i + 2] + +String(m[i + 3]).padEnd(3, "0") / 1000;
}

function parseSrt(text) {
  const cues = [];
  let cur = null;
  const flush = () => { if (cur && cur.text.length) cues.push(cur); cur = null; };
  text.replace(/\r\n?/g, "\n").split("\n").forEach(raw => {
    const line = raw.trim().replace(/^﻿/, "");
    const m = line.match(TIME_RE);
    if (m) { flush(); cur = { start: hms(m, 1), end: Math.max(hms(m, 5), hms(m, 1)), text: [] }; }
    else if (!line) flush();
    else if (cur) cur.text.push(line.replace(/<[^>]*>/g, "").trim());
    // a stray index line sits after a flush, so cur is null and it is ignored
  });
  flush();
  return cues.filter(c => c.text.join(" ").trim());
}

/* Merge cues into units. A cue is a subtitle line — "A GUY IN MY COMMENTS" — which is not
   a thing anyone would animate on its own; two or three of them make a clause that is. */
function toUnits(cues) {
  const out = [];
  let cur = null;
  cues.forEach(c => {
    // Decided BEFORE the cue goes in. Testing afterwards lets a unit overshoot by a whole
    // cue, and a 7-second unit is two scenes pretending to be one.
    if (cur && c.end - cur.start > UNIT_MAX && cur.end - cur.start >= UNIT_MIN) {
      out.push(cur);
      cur = null;
    }
    const text = c.text.join(" ").replace(/\s+/g, " ").trim();
    if (!cur) cur = { text: text, start: c.start, end: c.end };
    else { cur.text += " " + text; cur.end = c.end; }
    const dur = cur.end - cur.start;
    // a closing quote or bracket hides the full stop in front of it, and a transcript
    // of someone quoting themselves is full of them
    const last = cur.text.replace(/["'“”‘’)\]\s]+$/, "").slice(-1);
    const sentence = ".!?…".indexOf(last) >= 0;
    const clause = ",;:—–".indexOf(last) >= 0;
    if ((sentence && dur >= UNIT_MIN_SENTENCE) || (clause && dur >= UNIT_MIN_CLAUSE)) {
      out.push(cur);
      cur = null;
    }
  });
  if (cur) out.push(cur);
  return out;
}

const durOf = u => u.end - u.start;
const spanOf = list => list[list.length - 1].end - list[0].start;

function wordCount(s) { const t = String(s).trim(); return t ? t.split(/\s+/).length : 0; }

function fmtSecs(s) {
  return s < 60 ? s.toFixed(1) + "s"
                : Math.floor(s / 60) + ":" + (s % 60).toFixed(1).padStart(4, "0");
}

function fmtTC(t) {
  const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + s.toFixed(1).padStart(4, "0");
}

function rebuildUnits() {
  units = srtText ? toUnits(parseSrt(srtText)) : [];
  srtMeta();
  renderLines();
}

function srtMeta() {
  els.drop.classList.toggle("has", !!srtText);
  els.dropName.textContent = srtText ? (srtName || "Transcript loaded") : "Choose Transcript.srt";
  els.dropHint.textContent = srtText
    ? "Click it, or drop another file on it, to swap the transcript"
    : "or drag it straight in from the video's folder";
  if (!srtText) {
    els.srtMeta.textContent = "No transcript yet — pick Transcript.srt out of the video's folder.";
    els.srtMeta.className = "sh-meta";
    els.srtClear.hidden = true;
    return;
  }
  els.srtClear.hidden = false;
  if (!units.length) {
    els.srtMeta.textContent = "That file has no readable subtitles in it.";
    els.srtMeta.className = "sh-meta warn";
    return;
  }
  const total = units[units.length - 1].end;
  els.srtMeta.textContent = units.length + " lines, " +
    wordCount(units.map(u => u.text).join(" ")) + " words, " + fmtTC(total) +
    " of narration — every candidate comes back as a real timecode.";
  els.srtMeta.className = "sh-meta ok";
}

/* ---------------- the Shorts prompt ---------------- */

/* Each line carries its own length, so Claude can add a range up instead of estimating it
   from word count — which is the one thing it reliably gets wrong about a spoken script. */
function numberedScript() {
  const pad = String(units.length).length;
  return units.map((u, i) =>
    String(i + 1).padStart(pad, " ") + " | " + durOf(u).toFixed(1).padStart(4, " ") + "s | " + u.text
  ).join("\n");
}

/* The fixed half, pasted once into a Claude Project called "Shorts Finder". Everything
   that does not change between videos lives here, which is what lets the per-video request
   below be nothing but the clip window and the transcript — the same split the MG Project
   uses. The clip count DOES change run to run, so it travels in the request and the rules
   here only describe how to read it. */
const SHORTS_EXAMPLE_REQUEST = [
"Shorts for this video: 2 clips each, so 12-20 seconds per Short, 16 being the sweet spot.",
"",
" 1 | 3.4s | A GUY IN MY COMMENTS GOT A RAISE LAST YEAR,",
" 2 | 3.6s | $900 MORE EVERY SINGLE MONTH.",
" 3 | 2.9s | 14 MONTHS LATER, HE OWED MORE THAN THE DAY HE GOT IT.",
" 4 | 3.1s | NOT BECAUSE HE WAS RECKLESS. HE WAS NORMAL.",
" 5 | 3.3s | THE MONTH YOUR INCOME MOVES, THE OFFERS SHOW UP.",
" 6 | 2.8s | PRE-APPROVED. CONGRATULATIONS, YOU HAVE BEEN UPGRADED.",
" 7 | 3.0s | THAT IS NOT LUCK, AND IT IS NOT A COINCIDENCE.",
" 8 | 3.4s | YOUR CREDIT FILE IS A PRODUCT, AND SOMEBODY WHOSE INCOME JUST WENT UP",
" 9 | 2.6s | IS THE MOST VALUABLE NAME ON THAT LIST.",
].join("\n");

const SHORTS_EXAMPLE_REPLY = [
"SHORT 1 | lines 5-9 | 9/10 | Offers follow your raise",
"HOOK: Your raise is their payday",
"PULL: what should I do first when my income goes up?",
"WHY: Everyone has had the pre-approved letter, so the first line lands instantly, and in fifteen seconds it turns a lucky offer into proof that the viewer is the product — without saying what to do instead.",
"",
"SHORT 2 | lines 1-4 | 8/10 | He owed more after the raise",
"HOOK: $900 more a month. Still broke.",
"PULL: how does a raise leave someone worse off?",
"WHY: The number and the reversal both land inside seven seconds, and it names the trap without explaining it.",
"",
"Almost: lines 1-9 together would be the strongest cut here, but at 28 seconds it needs 3 clips, not 2.",
].join("\n");

const SHORTS_PROJECT_INSTRUCTIONS = [
"You find the stretches of my long-form YouTube videos that work as Shorts. I cut them out of the finished video using the footage and the narration exactly as they are — no re-recording, no reordering — and every Short links back to the full video. Do not ask me questions and do not explain yourself; just reply in the output format.",
"",
"== WHAT I SEND YOU ==",
"",
"One line saying how many motion-graphics clips I am building each Short out of and the length window that gives me, then the whole narration of one finished video, taken from its subtitle file:",
"",
"  line number | how long it takes to say | the words",
"",
"It is a transcript, so it is in capitals. The line numbers are what my app reads to pull the lines back out of my own copy of the script, so an off-by-one lands me on the wrong cut.",
"",
"== THE JOB ==",
"",
"A Short has ONE job: hold a stranger all the way to the end, and leave them wanting the rest. Those are two different things and a stretch has to do both.",
"",
"HOLD — it has to work as a video on its own:",
"1. IT HOOKS IN THREE SECONDS. The first line has to stop a thumb by itself: a surprising claim, a hard number, a direct \"you\", a question, or a scene the viewer is already standing in.",
"2. IT STARTS CLEAN. No \"that\", \"this\", \"so\", \"and that is why\", \"as I said\" pointing back at something that got cut away. If the first line only makes sense because of the line before it, the range starts in the wrong place — move it.",
"3. IT GIVES SOMETHING REAL. One idea, delivered inside the range: a number revealed, a belief flipped, a thing named. A pure tease that pays off nothing gets swiped away in two seconds, and YouTube stops showing it to anyone — which means it sends me no traffic at all.",
"",
"PULL — and it has to make the full video the obvious next click:",
"4. IT LEAVES ONE SPECIFIC THING OPEN. The stretch answers its own question but raises a bigger one it does not answer: the number is revealed but not what to do about it, the mistake is named but not the fix, one of five reasons is given. Vague mystery does not work — the viewer has to be able to say exactly what they still want to know. That sentence is what you write as PULL.",
"5. IT ENDS ON THE EDGE OF MORE. The last line is a payoff or a reframe that opens the door, never a tidy conclusion that closes the subject, and never mid-thought.",
"",
"MECHANICS:",
"6. ONE UNBROKEN RUN of line numbers, in order. I am cutting the existing edit, so I cannot skip a line in the middle or stitch two distant parts together.",
"7. IT FITS THE WINDOW at the top of the request. A motion-graphics clip can be at most 10 seconds and is wasteful under about 6, so the clip count I give you is what sets that window. Add up the per-line seconds and check before you commit to a range. Aim near the middle of the window: at the very top of it a range often will not divide into that many pieces at line boundaries. Outside the window I cannot build it at all, however well it reads, so do not offer it.",
"",
"Score each one on that whole job together — how many people it holds to the end AND how many of those then go looking for the full video. A stretch that holds beautifully but closes the subject completely is worth less to me than one that holds well and leaves a door open.",
"",
"== WHAT TO GIVE ME ==",
"",
"EVERY stretch that does both jobs and lands inside the window, best first. There is no target number of Shorts: some scripts hold two of these and some hold seven, and I would rather have two strong ones than eight I have to sift through. If a stretch only half works, leave it out and say so at the end instead.",
"",
"== OUTPUT FORMAT ==",
"",
"For each one, a line in EXACTLY this shape and nothing else on it:",
"",
"SHORT 1 | lines 42-55 | 9/10 | A short label for it",
"",
"(the word SHORT, its number, a pipe, the line range, a pipe, your score out of 10, a pipe, a few words naming it — no bold, no quotes, no extra punctuation). My app reads those lines, so keep the shape exact.",
"",
"Then directly under it, these three lines and nothing else:",
"",
"HOOK: the on-screen text for the first three seconds — six words or fewer",
"PULL: the one thing the viewer still wants to know when it ends, in their words, starting \"what/why/how...\" — this is the reason they click the full video",
"WHY: one sentence on why this holds a stranger, and what it gives them before it opens the door",
"",
"Then a blank line before the next one. After the list, name any stretch that ALMOST works and what is missing — a line that needs re-recording, a payoff that lands two lines too late, a range that is the right idea at the wrong length.",
"",
"== EXAMPLE ==",
"",
"I send:",
"",
SHORTS_EXAMPLE_REQUEST,
"",
"You reply:",
"",
SHORTS_EXAMPLE_REPLY,
].join("\n");

/* ...and the per-video half: the window I want this time, and the transcript. */
function buildShortsRequest() {
  const win = clipWindow(clipTarget);
  return [
"Shorts for this video: " + win.n + " clips each, so " + Math.round(win.min) + "-" +
  Math.round(win.max) + " seconds per Short, " + Math.round(win.ideal) + " being the sweet spot.",
"",
numberedScript(),
  ].join("\n");
}

/* ---------------- reply -> ranges ---------------- */

const SH_RE = new RegExp(
  "^\\s*(?:#{1,6}\\s*)?(?:[-*]\\s+)?(?:\\*\\*|__)?\\s*SHORT\\s*(\\d{1,2})\\s*(?:\\*\\*|__)?" +
  "\\s*[|:]\\s*(?:lines?\\s*)?(\\d{1,4})\\s*(?:[-\\u2013\\u2014]|to)\\s*(\\d{1,4})" +
  "\\s*\\|\\s*(?:score:?\\s*)?(\\d{1,2}(?:\\.\\d)?)\\s*/\\s*10\\s*\\|\\s*(.+?)\\s*$", "i");

const clean = s => String(s).replace(/\*\*|__/g, "").trim()
  .replace(/^["“”'‘’]+|["“”'‘’]+$/g, "").trim();

function parseShorts(text) {
  const out = [];
  let cur = null;
  text.replace(/\r\n?/g, "\n").split("\n").forEach(raw => {
    const m = raw.match(SH_RE);
    if (m) {
      const a = +m[2], b = +m[3];
      cur = { n: +m[1], from: Math.min(a, b), to: Math.max(a, b),
              score: m[4], label: clean(m[5]), type: "", pull: "", hook: "", why: "" };
      out.push(cur);
      return;
    }
    if (!cur) return;
    const t = raw.replace(/^\s*(?:[-*>]\s*)+/, "").replace(/\*\*|__/g, "").trim();
    if (!t) return;
    const kv = t.match(/^(TYPE|PULL|HOOK|WHY)\s*:\s*(.+)$/i);
    if (kv) cur[kv[1].toLowerCase()] = clean(kv[2]);
    else if (!cur.why) cur.why = clean(t);        // a reply that skipped the labels
  });
  return out;
}

/* ---------------- a Short -> Flow clips ---------------- */

/* Split a run of units into `n` contiguous groups as close to equal as possible, with no
   group longer than CLIP_MAX. Exact rather than greedy: greedy fills each clip to 10s and
   leaves the last one a stub, and a 2-second Flow clip is 6 wasted seconds of render. */
function balanced(list, n) {
  const m = list.length;
  if (n > m) return null;
  const target = spanOf(list) / n;
  const INF = Infinity;
  const best = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(INF));
  const cutAt = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(-1));
  best[0][m] = 0;
  for (let k = 1; k <= n; k++) {
    for (let i = m - 1; i >= 0; i--) {
      for (let j = i + 1; j <= m; j++) {
        const d = list[j - 1].end - list[i].start;
        if (d > CLIP_MAX + 0.05) break;          // groups only get longer from here
        const rest = best[k - 1][j];
        if (rest === INF) continue;
        const c = (d - target) * (d - target) + rest;
        if (c < best[k][i]) { best[k][i] = c; cutAt[k][i] = j; }
      }
    }
  }
  if (best[n][0] === INF) return null;
  const out = [];
  let i = 0;
  for (let k = n; k >= 1; k--) { const j = cutAt[k][i]; out.push(list.slice(i, j)); i = j; }
  return out;
}

function splitClips(list, n) {
  for (let k = Math.max(1, n); k <= list.length; k++) {
    const parts = balanced(list, k);
    if (parts) return parts;
  }
  return [list];        // one unit longer than a Flow clip; the card says so
}

/* The clips for the selected Short, with my character picks and text edits folded back
   in. Rebuilt from the transcript every time, so nudging a range or changing the clip
   count can never leave a stale clip behind. */
function clipsFor(s) {
  const list = units.slice(s.from - 1, s.to);
  if (!list.length) return [];
  const w = work[s.n] || {};
  // the setting is a wish, not a promise: splitClips() walks up from it when the line
  // boundaries cannot be made to fit, which is why each card prints what really came out
  const parts = splitClips(list, w.clipCount || clipTarget);
  return parts.map((p, i) => ({
    lines: p.map(u => u.text),
    text: (w.texts && w.texts[i] != null) ? w.texts[i] : p.map(u => u.text).join("\n"),
    len: Math.min(CLIP_MAX, Math.round(spanOf(p) * 10) / 10),
    char: (w.chars && w.chars[i]) || DEFAULT_CHAR,
    start: p[0].start,
    end: p[p.length - 1].end,
  }));
}

const readLines = t => String(t).split(/\r?\n/).map(s => s.trim()).filter(Boolean);

/* ---------------- render: the candidates ---------------- */

function inRange(s) { return s.from >= 1 && s.to <= units.length; }
function rangeText(s) { return units.slice(s.from - 1, s.to).map(u => u.text).join("\n"); }
function rangeTime(s) {
  return inRange(s) ? { start: units[s.from - 1].start, end: units[s.to - 1].end } : null;
}

function renderList() {
  if (!els.reply.value.trim()) {
    els.status.className = "settingsstatus";
    els.status.textContent = units.length ? "" : "Pick the transcript first.";
    els.list.innerHTML = "";
    return;
  }
  if (!shorts.length) {
    els.status.className = "settingsstatus err";
    els.status.textContent = "No candidates found — the prompt asks for lines shaped like  " +
      "SHORT 1 | lines 42-55 | 9/10 | A label . Paste the whole reply.";
    els.list.innerHTML = "";
    return;
  }
  els.status.className = "settingsstatus ok";
  els.status.textContent = shorts.length + " candidate" + (shorts.length === 1 ? "" : "s") +
    " — click one to build its Flow clips.";

  els.list.innerHTML = shorts.map((s, i) => {
    const ok = inRange(s);
    const text = ok ? rangeText(s) : "";
    const t = rangeTime(s);
    const secs = t ? t.end - t.start : 0;
    const clips = ok ? clipsFor(s).length : 0;
    const win = clipWindow(clipTarget);
    let lenCls = "", lenNote = "";
    if (secs > win.max) { lenCls = " bad"; lenNote = " — too long for " + win.n + " clips"; }
    else if (secs < win.min) { lenCls = " warn"; lenNote = " — short for " + win.n + " clips"; }

    return "<div class='sh-card" + (sel === s.n ? " on" : "") + "' data-i='" + i + "'>" +
      "<div class='sh-head'>" +
        "<span class='sh-score'>" + esc(s.score) + "/10</span>" +
        "<div class='sh-title'><b>" + esc(s.label || ("Short " + s.n)) + "</b>" +
          (s.type ? "<span class='sh-type'>" + esc(s.type) + "</span>" : "") + "</div>" +
        (ok ? "<span class='sh-len" + lenCls + "'>" + fmtSecs(secs) + esc(lenNote) + "</span>" : "") +
      "</div>" +
      (ok
        ? "<div class='sh-lines'>" + esc(text) + "</div>"
        : "<p class='sh-meta warn'>Lines " + s.from + "-" + s.to + " are outside this transcript " +
          "(it has " + units.length + " lines). Wrong transcript, or the reply drifted.</p>") +
      "<div class='sh-foot'>" +
        "<span class='sh-meta'>lines " + s.from + "–" + s.to + " · " +
          wordCount(text) + " words" +
          (t ? " · <b>" + fmtTC(t.start) + " → " + fmtTC(t.end) + "</b>" : "") +
          (clips ? " · <span class='" + (clips === win.n ? "" : "warn") + "'>" +
                   clips + " clip" + (clips === 1 ? "" : "s") + "</span>" : "") +
        "</span>" +
        "<span class='sh-nudge'>start" +
          "<button type='button' class='sh-nb' data-act='s-'>−</button>" +
          "<button type='button' class='sh-nb' data-act='s+'>+</button>" +
        "</span>" +
        "<span class='sh-nudge'>end" +
          "<button type='button' class='sh-nb' data-act='e-'>−</button>" +
          "<button type='button' class='sh-nb' data-act='e+'>+</button>" +
        "</span>" +
        (t ? "<button type='button' class='sbtn' data-act='tc'>⏱ Copy timecode</button>" : "") +
        (ok ? "<button type='button' class='btn sh-pick' data-act='pick'>" +
              (sel === s.n ? "✓ Building clips" : "→ Make the clips") + "</button>" : "") +
      "</div>" +
      (s.hook ? "<p class='sh-meta'><b>Hook text:</b> " + esc(s.hook) + "</p>" : "") +
      (s.pull ? "<p class='sh-meta'><b>Leaves them asking:</b> " + esc(s.pull) + "</p>" : "") +
      (s.why ? "<p class='sh-meta'>" + esc(s.why) + "</p>" : "") +
    "</div>";
  }).join("");

  els.list.querySelectorAll(".sh-card").forEach(card => {
    const i = +card.dataset.i;
    card.querySelectorAll("[data-act]").forEach(b =>
      b.addEventListener("click", e => { e.stopPropagation(); act(i, b.dataset.act); }));
    // anywhere on the card picks it, except over the transcript itself: that block is
    // there to be read and selected, and losing a selection to a tab change is maddening
    card.addEventListener("click", e => {
      if (e.target.closest(".sh-lines") || String(window.getSelection())) return;
      act(i, "pick");
    });
  });
}

function act(i, what) {
  const s = shorts[i];
  if (what === "tc") {
    const t = rangeTime(s);
    if (t) copyText(fmtTC(t.start) + " → " + fmtTC(t.end) + "   (" +
      fmtSecs(t.end - t.start) + ")   " + (s.label || ("Short " + s.n)));
    return;
  }
  if (what === "pick") {
    if (!inRange(s)) return;
    sel = sel === s.n ? null : s.n;
    renderList();
    renderWork();
    if (sel !== null) els.work.scrollIntoView({ behavior: "smooth", block: "start" });
    save();
    return;
  }
  // a nudge changes which lines the clips are cut from, so the edits to the old
  // ones no longer describe anything
  if (what === "s-") s.from = Math.max(1, s.from - 1);
  if (what === "s+") s.from = Math.min(s.to, s.from + 1);
  if (what === "e-") s.to = Math.max(s.from, s.to - 1);
  if (what === "e+") s.to = Math.min(units.length, s.to + 1);
  if (work[s.n]) { delete work[s.n].texts; delete work[s.n].clipCount; }
  renderList();
  renderWork();
  save();
}

/* ---------------- render: the clips for the chosen Short ---------------- */

function selected() { return shorts.find(s => s.n === sel) || null; }

function renderWork() {
  const s = selected();
  els.work.hidden = !s || !inRange(s);
  if (els.work.hidden) { els.clips.replaceChildren(); els.prompts.replaceChildren(); return; }

  const w = work[s.n] || (work[s.n] = {});
  if (typeof w.reply !== "string") w.reply = "";
  const clips = clipsFor(s);
  const t = rangeTime(s);

  els.workTitle.textContent = (s.label || ("Short " + s.n)) + " — " +
    fmtTC(t.start) + " → " + fmtTC(t.end) + " · " + fmtSecs(t.end - t.start);

  // ---- the clip cards
  els.clips.replaceChildren();
  clips.forEach((c, i) => {
    const node = els.clipTpl.content.firstElementChild.cloneNode(true);
    node.querySelector(".mg-video-title").textContent = "Clip " + (i + 1);
    node.querySelector(".sh-cliplen").textContent = MG.lenLabel(c.len) + "s";
    node.querySelectorAll(".mg-char input").forEach(r => {
      r.name = "sh-char-" + s.n + "-" + i;
      r.checked = r.value === c.char;
      r.addEventListener("change", () => {
        w.chars = clips.map((x, k) => k === i ? r.value : x.char);
        renderWork(); save();
      });
    });
    const box = node.querySelector(".mg-script");
    box.value = c.text;
    box.addEventListener("input", () => {
      w.texts = clips.map((x, k) => k === i ? box.value : x.text);
      refreshRequest(); save();
    });
    const note = clipNote(clips, i);
    const meta = node.querySelector(".mg-meta");
    meta.textContent = note.text;
    meta.classList.toggle("warn", note.warn);
    els.clips.appendChild(node);
  });

  const longest = Math.max.apply(null, clips.map(c => c.len));
  els.clipMeta.textContent = clips.length + " clip" + (clips.length === 1 ? "" : "s") +
    ", longest " + MG.lenLabel(longest) + "s" +
    (longest > CLIP_MAX + 0.05 ? " — longer than Flow can render" : "");
  els.clipMeta.classList.toggle("warn", longest > CLIP_MAX + 0.05);
  // asking for fewer clips is refused rather than ignored when the line boundaries do not
  // allow it: at 10s a clip, a run often has exactly one legal shape
  const list = units.slice(s.from - 1, s.to);
  els.fewer.disabled = clips.length <= 1 ||
    splitClips(list, clips.length - 1).length >= clips.length;
  els.more.disabled = clips.length >= list.length;

  els.mgReply.value = w.reply;
  refreshRequest();
}

function clipNote(clips, i) {
  const c = clips[i];
  const n = readLines(c.text).length;
  if (!n) return { text: "Empty, skipped", warn: true };
  const win = MG.sceneWindow(c.len, i > 0);
  const per = (win[1] - win[0]) / n;
  let text = n + (n === 1 ? " scene" : " scenes") + " · " + MG.fmt(per) +
    "s each · " + fmtTC(c.start) + " → " + fmtTC(c.end);
  let warn = false;
  // Only a real squeeze is worth flagging, and splitting is NOT the cure: every extra
  // clip spends another second on its opening and closing hold, so more clips leave
  // slightly less scene time, not more. Dense narration is just dense.
  if (per < MG.MIN_SCENE - 0.5) {
    warn = true;
    text = n + " scenes in " + MG.lenLabel(c.len) + "s is only " + MG.fmt(per) +
      "s each — the narration is fast here, so expect simpler scenes";
  }
  if (i > 0 && c.char !== clips[i - 1].char) text += " · character changes here";
  return { text: text, warn: warn };
}

function refreshRequest() {
  const s = selected();
  if (!s) return;
  const w = work[s.n] || {};
  const filled = clipsFor(s)
    .map(c => ({ lines: readLines(c.text), len: c.len, char: c.char }))
    .filter(c => c.lines.length);

  els.request.value = filled.length ? MG.buildRequest(filled) : "";
  els.copyReq.disabled = !filled.length;
  els.reqStatus.textContent = "";

  const scenes = MG.parseReply(w.reply || "");
  const found = filled.filter((_, i) => scenes[i + 1]).length;
  if (!(w.reply || "").trim()) {
    els.mgStatus.textContent = "Paste the reply to build the Flow prompts.";
    els.mgStatus.classList.remove("warn");
  } else {
    els.mgStatus.textContent = "Found scenes for " + found + " of " + filled.length +
      (filled.length === 1 ? " clip." : " clips.");
    els.mgStatus.classList.toggle("warn", found !== filled.length);
  }
  renderPrompts(filled, scenes);
}

function renderPrompts(filled, scenes) {
  els.prompts.replaceChildren();
  filled.forEach((v, i) => {
    const mode = MG.characterMode(filled, i);
    const node = els.promptTpl.content.firstElementChild.cloneNode(true);
    const render = MG.renderSeconds(v.len);
    node.querySelector(".mg-prompt-title").textContent =
      "Clip " + (i + 1) + " — " + MG.lenLabel(v.len) + "s · " + MG.NAMES[v.char].label;
    node.querySelector(".mg-attach").textContent =
      "Attach in Flow: " + MG.attachLine(v, mode, i, filled[i - 1]);
    const trim = node.querySelector(".mg-trim");
    if (render !== v.len) {
      const end = MG.sceneWindow(v.len, false)[1];
      trim.textContent = "In Flow pick " + render + "s, then trim the download to its first " +
        MG.fmt(v.len) + "s. The action ends at " + MG.fmt(end) +
        "s; everything after is the frozen final frame.";
      trim.hidden = false;
    }
    const box = node.querySelector(".mg-prompt-text");
    const button = node.querySelector(".mg-copy-prompt");
    if (scenes[i + 1]) box.value = MG.buildFlowPrompt(v, mode, scenes[i + 1]);
    else {
      box.value = "";
      box.placeholder = "Waiting for this clip's scenes in Claude's reply.";
      button.disabled = true;
    }
    els.prompts.appendChild(node);
  });
}

function renderLines() {
  els.lineWrap.hidden = !units.length;
  els.lineBox.textContent = numberedScript();
}

/* ---------------- state ---------------- */

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      srt: srtText, srtName: srtName, reply: els.reply.value, clipTarget: clipTarget,
      shorts: shorts, sel: sel, work: work,
    }));
  } catch (e) { /* a full or blocked store is not worth a toast on every keystroke */ }
}

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; }
}

/* ---------------- events ---------------- */

function takeSrt(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    srtText = String(r.result || "");
    srtName = file.name || "";
    rebuildUnits();
    renderList();
    renderWork();
    save();
  };
  r.readAsText(file);
}

els.srtFile.addEventListener("change", () => takeSrt(els.srtFile.files && els.srtFile.files[0]));

// Dropping the file in beats hunting for it in a dialog: it is already on screen in the
// video's folder. dragover has to be cancelled too, or the browser refuses the drop.
["dragenter", "dragover"].forEach(ev => els.drop.addEventListener(ev, e => {
  e.preventDefault();
  els.drop.classList.add("on");
}));
["dragleave", "dragend"].forEach(ev => els.drop.addEventListener(ev, () =>
  els.drop.classList.remove("on")));
els.drop.addEventListener("drop", e => {
  e.preventDefault();
  els.drop.classList.remove("on");
  takeSrt(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
});

// ...and a near miss would otherwise open the file in this tab and lose the page, so the
// whole panel swallows the drop instead
["dragover", "drop"].forEach(ev => els.tab.addEventListener(ev, e => e.preventDefault()));

function renderClipTarget() {
  els.clipSeg.forEach(r => { r.checked = +r.value === clipTarget; });
  const w = clipWindow(clipTarget);
  els.clipTargetMeta.textContent = "— so it hunts for stretches of about " +
    Math.round(w.min) + "–" + Math.round(w.max) + "s of script, " +
    Math.round(w.ideal) + "s being the sweet spot";
}

els.clipSeg.forEach(r => r.addEventListener("change", () => {
  if (!r.checked) return;
  clipTarget = +r.value;
  renderClipTarget();
  renderList();        // every candidate is re-judged against the new window
  renderWork();
  save();
}));

els.srtClear.addEventListener("click", e => {
  e.preventDefault();
  srtText = "";
  srtName = "";
  els.srtFile.value = "";
  rebuildUnits();
  renderList();
  renderWork();
  save();
});

els.buildBtn.addEventListener("click", () => {
  if (!units.length) { toast("Pick the video's Transcript.srt first", true); return; }
  els.promptOut.value = buildShortsRequest();
  els.promptWrap.style.display = "block";
  els.promptWrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

els.promptCopy.addEventListener("click", () => copyText(els.promptOut.value));

els.reply.addEventListener("input", () => {
  shorts = parseShorts(els.reply.value);
  if (!shorts.some(s => s.n === sel)) sel = null;
  renderList();
  renderWork();
  save();
});

els.workClose.addEventListener("click", () => {
  sel = null; renderList(); renderWork(); save();
});

els.fewer.addEventListener("click", () => bumpClips(-1));
els.more.addEventListener("click", () => bumpClips(1));

function bumpClips(d) {
  const s = selected();
  if (!s) return;
  const w = work[s.n] || (work[s.n] = {});
  const now = clipsFor(s).length;
  const want = Math.max(1, now + d);
  if (splitClips(units.slice(s.from - 1, s.to), want).length === now) return;
  w.clipCount = want;
  delete w.texts;                       // the clips are cut differently now
  renderWork();
  save();
}

els.copyReq.addEventListener("click", () => {
  if (!els.request.value) return;
  copyText(els.request.value);
  els.reqStatus.textContent = "Copied. Paste it into a new chat in your Claude Project.";
});

els.mgReply.addEventListener("input", () => {
  const s = selected();
  if (!s) return;
  (work[s.n] || (work[s.n] = {})).reply = els.mgReply.value;
  refreshRequest();
  save();
});

els.prompts.addEventListener("click", e => {
  const button = e.target.closest(".mg-copy-prompt");
  if (!button) return;
  copyText(button.closest(".mg-prompt").querySelector(".mg-prompt-text").value);
  button.textContent = "✓ Copied";
  setTimeout(() => { button.textContent = "📋 Copy"; }, 1500);
});

$("shCopyInstructions").addEventListener("click", () => {
  copyText(SHORTS_PROJECT_INSTRUCTIONS);
  els.setupStatus.textContent = "Copied — paste it into a Claude Project called \u201cShorts Finder\u201d.";
});

$("mgCopyInstructions").addEventListener("click", () => {
  copyText(MG.PROJECT_INSTRUCTIONS);
  els.setupStatus.textContent = "Copied — paste it into your MG Prompt Gen project's instructions.";
});

// Only while this tab is showing — the other tabs have their own boxes.
document.addEventListener("keydown", e => {
  if (e.ctrlKey && e.key === "Enter" && els.tab.classList.contains("active")) {
    e.preventDefault();
    els.buildBtn.click();
  }
});

/* ---------------- start ---------------- */

const saved = load();
if (saved) {
  if (typeof saved.srt === "string") srtText = saved.srt;
  if (typeof saved.srtName === "string") srtName = saved.srtName;
  if (CLIP_TARGETS.indexOf(saved.clipTarget) >= 0) clipTarget = saved.clipTarget;
  if (typeof saved.reply === "string") els.reply.value = saved.reply;
  if (saved.work && typeof saved.work === "object") work = saved.work;
  if (typeof saved.sel === "number") sel = saved.sel;
}
renderClipTarget();
rebuildUnits();
// the saved ranges carry my nudges; fall back to re-reading the reply
shorts = (saved && Array.isArray(saved.shorts) && saved.shorts.length)
  ? saved.shorts : parseShorts(els.reply.value);
if (!shorts.some(s => s.n === sel)) sel = null;
renderList();
renderWork();

})();
