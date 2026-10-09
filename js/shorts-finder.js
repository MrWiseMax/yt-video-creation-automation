"use strict";
/* ================= Shorts Finder tab =================
   Finds the stretches of a finished long-form script that stand on their own as Shorts,
   so I stop re-reading 200 lines looking for them by eye.

   Same house rule as every other tab: nothing here calls an API. It builds a prompt I
   paste into the Claude app, and reads the reply back.

   The one idea that makes this work: Claude answers with LINE NUMBERS, never with the
   text. The app then pulls the lines out of my own script, which means the text on screen
   is always verbatim, the word count and the runtime are real, and a drifted range shows
   itself immediately instead of hiding behind a paraphrase. It is also what lets the
   nudge buttons move a range by a line without asking Claude anything.

   Drop in Transcript.srt as well and the ranges come back as actual timecodes, because
   then there is nothing left to do but scrub to that point in Premiere and cut. The
   alignment is word-level (the SRT breaks lines for subtitles, not for breath, so the two
   files never line up one-to-one) — see alignTimes().

   Relies on globals from script.js: $, copyText, toast, esc. */
(function () {

const KEY = "shortsFinder.v1";

// 1502 words over 9:35 of finished narration, measured off my own transcript. Shorts live
// or die on whether they fit, so this is a measured number and not a textbook 150 wpm.
const WPS = 2.61;

const SHORT_MIN_SECS = 15;    // under this it is a clip, not a Short
const SHORT_MAX_SECS = 58;    // over this it stops being a Short at all
const SWEET_MIN = 20, SWEET_MAX = 45;
const DEFAULT_COUNT = 8;

const els = {
  tab:        document.getElementById("tab-shorts"),
  script:     document.getElementById("shScript"),
  scriptMeta: document.getElementById("shScriptMeta"),
  pull:       document.getElementById("shPullScript"),
  srtFile:    document.getElementById("shSrtFile"),
  srtMeta:    document.getElementById("shSrtMeta"),
  srtClear:   document.getElementById("shSrtClear"),
  count:      document.getElementById("shCount"),
  buildBtn:   document.getElementById("shBuildBtn"),
  promptWrap: document.getElementById("shPromptWrap"),
  promptOut:  document.getElementById("shPromptOut"),
  promptCopy: document.getElementById("shPromptCopy"),
  reply:      document.getElementById("shReply"),
  status:     document.getElementById("shReplyStatus"),
  list:       document.getElementById("shList"),
  lineWrap:   document.getElementById("shLinesWrap"),
  lineBox:    document.getElementById("shLines"),
};

let shorts = [];        // [{ n, from, to, score, label, type, hook, why }]  1-based, inclusive
let srtText = "";       // raw Transcript.srt, when one has been picked
let lineTimes = [];     // per script line: { start, end } in seconds, or null

/* ---------------- script ---------------- */

/* Blank lines are dropped and what is left is numbered 1..N. The script file uses blank
   lines to group beats, and numbering them would mean the numbers in the prompt and the
   numbers in the file disagree the moment I add one — so the numbering follows the SPOKEN
   lines, which is also what I count when I read the file myself. */
function lines() {
  return els.script.value.replace(/\r\n?/g, "\n").split("\n")
    .map(s => s.trim()).filter(Boolean);
}

function wordCount(s) { const t = s.trim(); return t ? t.split(/\s+/).length : 0; }

function secsOf(text) { return wordCount(text) / WPS; }

function fmtSecs(s) { return s < 60 ? s.toFixed(1) + "s" : Math.floor(s / 60) + ":" + (s % 60).toFixed(1).padStart(4, "0"); }

function fmtTC(t) {
  const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + s.toFixed(1).padStart(4, "0");
}

function tok(s) {
  return s.toLowerCase()
    .replace(/<[^>]*>/g, " ")
    .replace(/[’‘'`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim().split(/\s+/).filter(Boolean);
}

/* ---------------- the SRT, for real timecodes ---------------- */

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
    else if (cur) cur.text.push(line);
    // a stray index line sits after a flush, so cur is null and it is ignored
  });
  flush();
  return cues;
}

/* Every subtitle word with a time of its own, interpolated inside its cue and weighted by
   word length — the same rough speech model pipeline.py uses to place scenes. */
function srtWordStream(cues) {
  const out = [];
  cues.forEach(c => {
    const toks = tok(c.text.join(" "));
    if (!toks.length) return;
    const w = toks.map(t => t.length + 1);
    const total = w.reduce((a, b) => a + b, 0);
    const span = Math.max(c.end - c.start, 1e-4);
    let t = c.start;
    toks.forEach((tk, i) => {
      const d = span * (w[i] / total);
      out.push({ w: tk, t0: t, t1: t + d });
      t += d;
    });
  });
  return out;
}

/* Hang every script line on the subtitle timeline.
   The two files hold the same words in the same order but break them differently, so this
   walks both word streams together and only has to survive the small disagreements a
   transcription makes (a dropped "the", a heard-wrong word). On a mismatch it looks a
   short way ahead in each stream and resyncs on the first agreement; if neither finds one
   it steps both and carries on, which costs one word rather than the rest of the file. */
function alignTimes(ls, stream) {
  const A = [];
  ls.forEach((ln, i) => tok(ln).forEach(w => A.push({ w: w, line: i })));
  const times = ls.map(() => null);
  let i = 0, j = 0;
  while (i < A.length && j < stream.length) {
    if (A[i].w === stream[j].w) {
      const k = A[i].line;
      if (!times[k]) times[k] = { start: stream[j].t0, end: stream[j].t1 };
      else {
        times[k].start = Math.min(times[k].start, stream[j].t0);
        times[k].end = Math.max(times[k].end, stream[j].t1);
      }
      i++; j++;
      continue;
    }
    let moved = false;
    for (let d = 1; d <= 10 && !moved; d++) {
      if (j + d < stream.length && A[i].w === stream[j + d].w) { j += d; moved = true; }
      else if (i + d < A.length && A[i + d].w === stream[j].w) { i += d; moved = true; }
    }
    if (!moved) { i++; j++; }
  }
  return times;
}

function rebuildTimes() {
  const ls = lines();
  lineTimes = [];
  if (!srtText || !ls.length) { srtMeta(); return; }
  lineTimes = alignTimes(ls, srtWordStream(parseSrt(srtText)));
  srtMeta();
}

function srtMeta() {
  const ls = lines();
  if (!srtText) {
    els.srtMeta.textContent = "No transcript picked — runtimes below are estimated from the word count.";
    els.srtMeta.className = "sh-meta";
    els.srtClear.hidden = true;
    return;
  }
  els.srtClear.hidden = false;
  const hit = lineTimes.filter(Boolean).length;
  const pct = ls.length ? Math.round(hit / ls.length * 100) : 0;
  if (pct >= 80) {
    els.srtMeta.textContent = "Transcript matched " + hit + " of " + ls.length +
      " lines (" + pct + "%) — every range below comes back as a real timecode.";
    els.srtMeta.className = "sh-meta ok";
  } else {
    els.srtMeta.textContent = "Transcript only matched " + pct + "% of the script — is this " +
      "the transcript for THIS video? Timecodes will be patchy.";
    els.srtMeta.className = "sh-meta warn";
  }
}

/* The timecode of a 1-based inclusive line range, or null when the SRT cannot place it.
   Falls inward to the nearest line that WAS placed, so one unmatched line at an edge
   costs a little accuracy instead of the whole range. */
function rangeTime(from, to) {
  if (!lineTimes.length) return null;
  let a = null, b = null;
  for (let i = from - 1; i <= to - 1 && a === null; i++) if (lineTimes[i]) a = lineTimes[i].start;
  for (let i = to - 1; i >= from - 1 && b === null; i--) if (lineTimes[i]) b = lineTimes[i].end;
  return a === null || b === null || b <= a ? null : { start: a, end: b };
}

/* ---------------- the prompt ---------------- */

function numberedScript(ls) {
  const pad = String(ls.length).length;
  return ls.map((l, i) => String(i + 1).padStart(pad, " ") + " | " + l).join("\n");
}

function buildPrompt(ls, want) {
  return [
"Act as a YouTube Shorts editor.",
"",
"Below is the complete voice-over script of a long-form video I have already finished. I want to cut Shorts out of it using the footage and the narration exactly as they are — no re-recording, no reordering. Your job is to find the stretches of this script that stand on their own as Shorts.",
"",
"A stretch only works as a Short if ALL of these are true:",
"",
"1. SELF-CONTAINED. Someone who has never seen the long video understands it from its very first word. No \"that\", \"this\", \"so\", \"and that is why\", \"as I said\" pointing back at something that got cut away. If the first line only makes sense because of the line before it, the range starts in the wrong place — move it.",
"2. IT HOOKS IN THREE SECONDS. The first line has to stop a thumb by itself: a surprising claim, a hard number, a direct \"you\", a question, or a scene the viewer is already standing in.",
"3. ONE IDEA, AND IT LANDS. Something is opened and then closed inside the range — a question answered, a number revealed, a belief flipped. A stretch that is only setup, or only the conclusion of an argument that happened earlier, is not a Short.",
"4. IT ENDS ON A PUNCH. The last line is a payoff, a reframe, or a question worth answering in the comments. Never mid-thought, and never trailing into the next topic.",
"5. IT IS ONE UNBROKEN RUN of line numbers, in order. I am cutting the existing edit, so I cannot skip a line in the middle or stitch two distant parts together.",
"6. IT FITS. Roughly " + SWEET_MIN + " to " + SWEET_MAX + " seconds spoken, and never more than " + SHORT_MAX_SECS + ". I speak about " + WPS.toFixed(1) + " words a second, so count the words in the range and check before you commit to it.",
"",
"Rank them by how well each one would hold a cold viewer who has never heard of me — not by how important that part is to the long video.",
"",
"Most of what you give me should be the self-contained kind above. At most two may be TEASER type: a hook or a promise from the opening that deliberately does not pay off, made to send people to the full video. Mark those honestly so I know what I am looking at.",
"",
"--- THE SCRIPT ---",
"",
"Every spoken line is numbered. Use these numbers exactly as printed — they are what my app reads to pull the lines back out, so an off-by-one lands me on the wrong cut.",
"",
numberedScript(ls),
"",
"--- WHAT I WANT ---",
"",
"The " + want + " best candidates, best first. For each one, start with a line in EXACTLY this shape and nothing else on it:",
"",
"SHORT 1 | lines 42-55 | 9/10 | A short label for it",
"",
"(the word SHORT, its number, a pipe, the line range, a pipe, your score out of 10, a pipe, a few words naming it — no bold, no quotes, no extra punctuation). My app reads those lines, so keep the shape exact.",
"",
"Then directly under it, these three lines and nothing else:",
"",
"TYPE: self-contained   (or: teaser)",
"HOOK: the on-screen text for the first three seconds — six words or fewer",
"WHY: one sentence on why this holds a stranger, and what the payoff is",
"",
"Then a blank line before the next one.",
"",
"Two more things, after the list:",
"- Name any part of the script that ALMOST works but needs a line re-recorded, and say which line.",
"- Do not ask me clarifying questions first. Just deliver.",
  ].join("\n");
}

/* ---------------- reply -> ranges ---------------- */

/* Pinned to the "SHORT n | lines a-b | s/10 | label" shape by the prompt, and forgiving of
   what the Claude app's copy button tends to carry along: a heading mark, a bullet, bold.
   The score has to be there — it is the one thing that cannot show up by accident in a
   line of prose about a Short. */
const SH_RE = new RegExp(
  "^\\s*(?:#{1,6}\\s*)?(?:[-*]\\s+)?(?:\\*\\*|__)?\\s*SHORT\\s*(\\d{1,2})\\s*(?:\\*\\*|__)?" +
  "\\s*[|:]\\s*(?:lines?\\s*)?(\\d{1,4})\\s*(?:[-\\u2013\\u2014]|to)\\s*(\\d{1,4})" +
  "\\s*\\|\\s*(?:score:?\\s*)?(\\d{1,2}(?:\\.\\d)?)\\s*/\\s*10\\s*\\|\\s*(.+?)\\s*$", "i");

const clean = s => String(s).replace(/\*\*|__/g, "").trim()
  .replace(/^["“”'‘’]+|["“”'‘’]+$/g, "").trim();

function parseReply(text) {
  const out = [];
  let cur = null;
  text.replace(/\r\n?/g, "\n").split("\n").forEach(raw => {
    const m = raw.match(SH_RE);
    if (m) {
      const from = +m[2], to = +m[3];
      cur = { n: +m[1], from: Math.min(from, to), to: Math.max(from, to),
              score: m[4], label: clean(m[5]), type: "", hook: "", why: "" };
      out.push(cur);
      return;
    }
    if (!cur) return;
    const t = raw.replace(/^\s*(?:[-*>]\s*)+/, "").replace(/\*\*|__/g, "").trim();
    if (!t) return;
    const kv = t.match(/^(TYPE|HOOK|WHY)\s*:\s*(.+)$/i);
    if (kv) cur[kv[1].toLowerCase()] = clean(kv[2]);
    else if (!cur.why) cur.why = clean(t);        // a reply that skipped the labels
  });
  return out;
}

/* ---------------- render ---------------- */

function rangeText(from, to) {
  return lines().slice(from - 1, to).join("\n");
}

function render() {
  const ls = lines();
  const hasReply = els.reply.value.trim().length > 0;

  if (!hasReply) {
    els.status.className = "settingsstatus";
    els.status.textContent = "";
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
    " — the text under each one is pulled straight from your script, so what you see is " +
    "exactly what gets said.";

  els.list.innerHTML = shorts.map((s, i) => {
    const bad = s.from < 1 || s.to > ls.length;
    const text = bad ? "" : rangeText(s.from, s.to);
    const t = bad ? null : rangeTime(s.from, s.to);
    const secs = t ? t.end - t.start : secsOf(text);
    const tag = t ? "" : "~";
    let lenCls = "", lenNote = "";
    if (secs > SHORT_MAX_SECS) { lenCls = " bad"; lenNote = " — too long for a Short"; }
    else if (secs < SHORT_MIN_SECS) { lenCls = " bad"; lenNote = " — very short"; }
    else if (secs > SWEET_MAX) { lenCls = " warn"; lenNote = " — trim a line or two"; }

    return "<div class='sh-card' data-i='" + i + "'>" +
      "<div class='sh-head'>" +
        "<span class='sh-score'>" + esc(s.score) + "/10</span>" +
        "<div class='sh-title'><b>" + esc(s.label || ("Short " + s.n)) + "</b>" +
          (s.type ? "<span class='sh-type'>" + esc(s.type) + "</span>" : "") + "</div>" +
        (bad ? "" : "<span class='sh-len" + lenCls + "'>" + tag + fmtSecs(secs) +
                    esc(lenNote) + "</span>") +
      "</div>" +
      (bad
        ? "<p class='sh-meta warn'>Lines " + s.from + "-" + s.to + " are outside this script " +
          "(it has " + ls.length + " lines). Re-paste the script, or the reply drifted.</p>"
        : "<div class='sh-lines'>" + esc(text) + "</div>") +
      "<div class='sh-foot'>" +
        "<span class='sh-meta'>lines " + s.from + "–" + s.to + " · " +
          wordCount(text) + " words" +
          (t ? " · <b>" + fmtTC(t.start) + " → " + fmtTC(t.end) + "</b>" : "") +
        "</span>" +
        "<span class='sh-nudge'>start" +
          "<button type='button' class='sh-nb' data-act='s-'>−</button>" +
          "<button type='button' class='sh-nb' data-act='s+'>+</button>" +
        "</span>" +
        "<span class='sh-nudge'>end" +
          "<button type='button' class='sh-nb' data-act='e-'>−</button>" +
          "<button type='button' class='sh-nb' data-act='e+'>+</button>" +
        "</span>" +
        "<button type='button' class='sbtn' data-act='copy'>📋 Copy lines</button>" +
        (t ? "<button type='button' class='sbtn' data-act='tc'>⏱ Copy timecode</button>" : "") +
      "</div>" +
      (s.hook ? "<p class='sh-meta'><b>Hook text:</b> " + esc(s.hook) + "</p>" : "") +
      (s.why ? "<p class='sh-meta'>" + esc(s.why) + "</p>" : "") +
    "</div>";
  }).join("");

  els.list.querySelectorAll(".sh-card").forEach(card => {
    card.querySelectorAll("[data-act]").forEach(b =>
      b.addEventListener("click", () => act(+card.dataset.i, b.dataset.act)));
  });
}

function act(i, what) {
  const s = shorts[i], n = lines().length;
  if (what === "copy") { copyText(rangeText(s.from, s.to)); return; }
  if (what === "tc") {
    const t = rangeTime(s.from, s.to);
    if (t) copyText(fmtTC(t.start) + " → " + fmtTC(t.end) + "   (" +
      fmtSecs(t.end - t.start) + ")   " + (s.label || ("Short " + s.n)));
    return;
  }
  if (what === "s-") s.from = Math.max(1, s.from - 1);
  if (what === "s+") s.from = Math.min(s.to, s.from + 1);
  if (what === "e-") s.to = Math.max(s.from, s.to - 1);
  if (what === "e+") s.to = Math.min(n, s.to + 1);
  render();
  save();
}

function renderLines() {
  const ls = lines();
  els.lineWrap.hidden = !ls.length;
  els.lineBox.textContent = numberedScript(ls);
}

function scriptMeta() {
  const ls = lines();
  const n = wordCount(ls.join(" "));
  els.scriptMeta.textContent = ls.length
    ? "— " + ls.length + " spoken lines, " + n + " words (~" + fmtSecs(n / WPS) + " of narration)"
    : "— required, empty right now";
}

/* ---------------- state ---------------- */

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      script: els.script.value, reply: els.reply.value, srt: srtText,
      count: els.count.value, shorts: shorts,
    }));
  } catch (e) { /* a full or blocked store is not worth a toast on every keystroke */ }
}

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; }
}

/* ---------------- events ---------------- */

function scriptChanged() {
  scriptMeta();
  renderLines();
  rebuildTimes();
  render();
  save();
}

els.script.addEventListener("input", scriptChanged);

els.pull.addEventListener("click", () => {
  const v = (document.getElementById("voScript") || {}).value || "";
  if (!v.trim()) { toast("The 🎬 Create Video tab has no script in it yet", true); return; }
  els.script.value = v;
  scriptChanged();
  toast("Script pulled in ✓");
});

els.srtFile.addEventListener("change", () => {
  const f = els.srtFile.files && els.srtFile.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    srtText = String(r.result || "");
    rebuildTimes();
    render();
    save();
  };
  r.readAsText(f);
});

els.srtClear.addEventListener("click", () => {
  srtText = "";
  els.srtFile.value = "";
  lineTimes = [];
  srtMeta(); render(); save();
});

els.count.addEventListener("change", save);

els.buildBtn.addEventListener("click", () => {
  const ls = lines();
  if (!ls.length) { toast("Paste the finished voice-over script first", true); return; }
  const want = Math.max(1, Math.min(20, +els.count.value || DEFAULT_COUNT));
  els.promptOut.value = buildPrompt(ls, want);
  els.promptWrap.style.display = "block";
  els.promptWrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

els.promptCopy.addEventListener("click", () => copyText(els.promptOut.value));

els.reply.addEventListener("input", () => {
  shorts = parseReply(els.reply.value);
  render();
  save();
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
  if (typeof saved.script === "string") els.script.value = saved.script;
  if (typeof saved.reply === "string") els.reply.value = saved.reply;
  if (typeof saved.srt === "string") srtText = saved.srt;
  if (saved.count) els.count.value = saved.count;
}
scriptMeta();
renderLines();
rebuildTimes();
// the saved ranges carry my nudges; fall back to re-reading the reply
shorts = (saved && Array.isArray(saved.shorts) && saved.shorts.length)
  ? saved.shorts : parseReply(els.reply.value);
render();

})();
