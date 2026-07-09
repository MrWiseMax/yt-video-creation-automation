"use strict";

/* ================= Supabase ("YT Automation" project) ================= */
const SB_URL = "https://jgctukihjumyznviyavy.supabase.co/rest/v1";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpnY3R1a2loanVteXpudml5YXZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1ODI5NTQsImV4cCI6MjA5OTE1ODk1NH0.b1ugnKHCIUEOvITV4VF9v1ZYwMrWWsIimrLjLBBjMIA";
const T_SETTINGS = "script_creation_settings";
const T_VIDEOS = "script_creation_videos";

async function sb(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(SB_URL + path, Object.assign({ signal: ctrl.signal }, opts, {
      headers: Object.assign({
        apikey: SB_KEY,
        Authorization: "Bearer " + SB_KEY,
        "Content-Type": "application/json"
      }, opts.headers || {})
    }));
    if (!res.ok) throw new Error("Supabase " + res.status + ": " + await res.text());
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}

/* ================= state (in memory — the cloud is the storage) ================= */
let settings = { samples: ["", "", ""], duration: "8-12" };
function blankVideo() { return { id: null, title: "", keyPoints: "", voScript: "", done: {}, step: "s1" }; }
let video = blankVideo();
let currentPanel = "setup";
let dirty = false;
let settingsTimer = null;
let videoRows = [];

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ================= prompt templates ================= */
function buildPrompt1() {
  const samples = settings.samples.map(s => s.trim()).filter(Boolean);
  const sampleBlock = samples.length
    ? samples.map((s, i) => "SAMPLE " + (i + 1) + ":\n" + s).join("\n\n")
    : "SAMPLE 1:\n(!! no sample scripts saved yet — add them in the Setup page !!)";
  const title = video.title.trim() || "(!! fill in the video title / idea above !!)";
  const points = video.keyPoints.trim() || "(!! fill in the key points above !!)";
  const dur = settings.duration.trim() || "8-12";
  return [
"You are a professional YouTube scriptwriter. Write a complete, ready-to-record voice-over script for my next video, matching my channel's exact tone and rhythm.",
"",
"--- MY SAMPLE SCRIPTS (study these for tone, rhythm and structure only - do NOT reuse their content or examples) ---",
"",
sampleBlock,
"",
"--- THE NEW VIDEO ---",
"",
"TOPIC / IDEA:",
title,
"",
"KEY POINTS TO COVER (keep this order unless a clearly better order exists - if you reorder, say why at the very end, after the script, in one short note):",
points,
"",
"TARGET LENGTH: " + dur + " minutes.",
"My voice-over pace is about 155-165 spoken words per minute, so aim for roughly TARGET MINUTES x 160 words. For a range, land near the middle. Count your words before finishing; expand or trim the BODY sections (never the hook, never the ending) to land inside the target range.",
"",
"--- TONE RULES ---",
"- Before writing, silently analyze my samples: how they hook in the first seconds, sentence length and rhythm, vocabulary level, how they talk to the viewer, use of questions and repetition for emphasis, how they transition between points, and how they close with a call to action. Mirror ALL of it.",
"- Write for the ear, not the eye: contractions, direct address (\"you\"), short punchy sentences, concrete everyday examples.",
"- Stay 100% consistent with the samples' personality. If they are calm and sincere, do not become hype. If they are playful, do not become formal.",
"",
"--- FORMAT RULES (critical - my recording and editing pipeline depends on these exactly, this is the content of the file, not your chat reply) ---",
"- The script itself contains ONLY the script text. No title, no headings, no scene numbers, no [pause] or stage directions, no markdown, no emojis, no notes before or inside the script.",
"- ONE BREATH PER LINE: each line is one short spoken phrase I can say in a single breath - about 4 to 12 words. Never more than 14 words on one line. A long sentence simply continues on the next line.",
"- Every line must end at a natural pause point (comma, period, or a natural spoken break).",
"- No empty lines anywhere in the script.",
"- Never use double quotation marks (\") anywhere; if you must quote spoken words, use single quotes ('like this').",
"- Example of the EXACT line style I need:",
"",
"But here is what nobody tells you.",
"You cannot grow inside box one.",
"Your 9 to 5 keeps you alive,",
"but it does not move you forward.",
"Because the second they cut your paycheck,",
"you are done.",
"",
"--- WHAT TO OUTPUT (read carefully) ---",
"- Go straight to creating a downloadable .txt file named exactly voice-over-script.txt containing the full script, formatted exactly as above.",
"- Do NOT print the script text in the chat reply itself - it belongs ONLY inside the file. After the file is created you may add one short confirmation sentence, nothing more.",
"- ONLY IF your tool is genuinely unable to create downloadable files: then output the full script as plain chat text instead, in the exact same format, as a fallback.",
"",
"Now write the full script."
  ].join("\n");
}

function buildPrompt2() {
  const script = video.voScript.trim() || "(!! paste your voice-over script above !!)";
  return [
"You are creating image-generation prompts for a YouTube video. The script below is split into short breath-lines. Group the lines into scenes of EXACTLY TWO CONSECUTIVE LINES each - one scene = one image = two breath-lines combined. If the script has an odd number of lines, the LAST scene may contain just the final single line. Do not merge non-consecutive lines, do not split a pair of lines across two scenes, do not skip lines, and never reword a line.",
"",
"--- CHARACTER & STYLE (applies to every prompt) ---",
"- Every prompt starts with: \"Use the character from the uploaded image reference.\" Then describe this scene.",
"- In each prompt describe: the character's action, pose and expression that visually acts out BOTH lines of the scene together as one moment; the setting; 1-2 concrete environment details; the lighting; and the overall energy in a short closing phrase.",
"- Realistic, grounded, relatable body language - never exaggerated or cartoonish. No white background, no glow.",
"- Keep the location consistent across consecutive scenes that clearly happen in the same place (same office, same living room, same street), and only change setting when the narration moves on.",
"- 40-80 words per prompt.",
"",
"--- FILE FORMAT (exact, for every scene - this is the content of the file, not your chat reply) ---",
"",
"SCENE <number>",
"",
"\"<line 1 copied EXACTLY> <line 2 copied EXACTLY>\"",
"",
"<the image prompt paragraph, as ONE single line of text>",
"",
"Number the scenes 1, 2, 3... in script order. The quoted text must be the two script lines copied EXACTLY (same words, same punctuation) and joined with a single space - never reworded, never merged into new wording. My editing pipeline matches this text against the recorded audio, so ANY change breaks the video timing.",
"",
"Here is an example of the exact style and format I want, using 4 script lines that become 2 scenes:",
"",
"Script lines:",
"For years, I tried to fix my habits.",
"I would wake up super motivated.",
"Then three days later, back to zero.",
"And I always blamed myself for it.",
"",
"SCENE 1",
"",
"\"For years, I tried to fix my habits. I would wake up super motivated.\"",
"",
"Use the character from the uploaded image reference. The character stands in front of a bathroom mirror early in the morning, fists lightly clenched at chest height, a determined, hopeful expression - the look of someone starting fresh. Bright clean morning light. Simple tidy bathroom, a sticky-note goal stuck to the mirror edge. Motivated, energetic energy.",
"",
"SCENE 2",
"",
"\"Then three days later, back to zero. And I always blamed myself for it.\"",
"",
"Use the character from the uploaded image reference. The character sits slumped on the edge of the same bed, shoulders low, staring blankly at the floor, the sticky note now crumpled in one hand. Dim flat daylight. Same simple bedroom, now slightly messier. Deflated, self-critical energy.",
"",
"--- WHAT TO OUTPUT (read carefully) ---",
"- First, count the non-empty script lines, work out how many two-line scenes that makes (round up if the line count is odd), and output exactly one line in the chat:   TOTAL SCENES: <n>",
"- Then go straight to creating a downloadable .txt file named exactly original-scenes-prompts.txt containing ALL scenes, start to finish, in order, each formatted exactly as SCENE <number> / quoted two-line sentence / prompt paragraph, separated by blank lines, with nothing else added before or after.",
"- Do NOT print the SCENE blocks in the chat reply itself - they belong ONLY inside the file. After the file is created you may add one short confirmation sentence, nothing more.",
"- Work through every scene up to <n> without pausing, asking to continue, summarizing, skipping ahead, or restarting numbering.",
"- ONLY IF your tool is genuinely unable to create downloadable files: then output all scenes as plain chat text instead, in the exact same format, as a fallback.",
"",
"--- THE SCRIPT (breath-lines - group every 2 into one scene) ---",
"",
script
  ].join("\n");
}

/* ================= script analysis ================= */
function analyzeScript(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const words = lines.reduce((n, l) => n + l.split(/\s+/).length, 0);
  const long = [];
  lines.forEach((l, i) => { const w = l.split(/\s+/).length; if (w > 14) long.push({ n: i + 1, w, text: l }); });
  const quotes = lines.filter(l => l.includes('"')).length;
  const scenes = Math.ceil(lines.length / 2);
  return { lines: lines.length, words, minutes: words / 160, long, quotes, scenes };
}

function renderStats() {
  const box = $("scriptStats"), ll = $("longLines");
  const t = video.voScript.trim();
  if (!t) { box.innerHTML = ""; ll.textContent = ""; return; }
  const a = analyzeScript(t);
  let html = "";
  html += "<div class='stat'><b>" + a.lines + "</b>breath lines</div>";
  html += "<div class='stat'><b>" + a.scenes + "</b>scenes / images — 2 lines each</div>";
  html += "<div class='stat'><b>" + a.words + "</b>words</div>";
  html += "<div class='stat'><b>≈ " + a.minutes.toFixed(1) + " min</b>at ~160 words/min</div>";
  html += "<div class='stat" + (a.long.length ? " bad" : "") + "'><b>" + a.long.length + "</b>lines over 14 words</div>";
  if (a.quotes) html += "<div class='stat bad'><b>" + a.quotes + "</b>lines with double quotes</div>";
  box.innerHTML = html;
  ll.textContent = a.long.slice(0, 8).map(x => "line " + x.n + " (" + x.w + " words): " + x.text).join("\n")
    + (a.long.length > 8 ? "\n...and " + (a.long.length - 8) + " more" : "");
}

/* ================= cloud: settings ================= */
function setSettingsStatus(msg, cls) {
  const el = $("settingsStatus");
  el.textContent = msg; el.className = "settingsstatus " + (cls || "");
}
function queueSettingsSave() {
  setSettingsStatus("Saving to cloud…");
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(async () => {
    try {
      await sb("/" + T_SETTINGS + "?id=eq.1", {
        method: "PATCH",
        body: JSON.stringify({ samples: settings.samples, duration: settings.duration })
      });
      setSettingsStatus("✓ Settings saved to cloud", "ok");
    } catch (e) {
      console.error(e);
      setSettingsStatus("⚠ Could not save settings — check internet, then type again to retry", "err");
    }
  }, 1200);
}

/* ================= cloud: videos ================= */
function setCloudStatus(msg, cls) {
  const el = $("cloudStatus");
  el.textContent = msg; el.className = "cloudstatus " + (cls || "");
}

async function saveVideo() {
  const title = video.title.trim();
  if (!title) { toast("Give the video a title first (Step 1)", true); go("s1"); $("vidTitle").focus(); return; }
  const btn = $("saveVideoBtn");
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    const rows = await sb("/" + T_VIDEOS + "?on_conflict=title", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        title,
        key_points: video.keyPoints,
        vo_script: video.voScript,
        done: video.done,
        current_step: video.step,
        updated_at: new Date().toISOString()
      })
    });
    if (rows && rows[0]) video.id = rows[0].id;
    dirty = false;
    toast("Saved to cloud ✓");
    await refreshVideoList();
  } catch (e) {
    console.error(e);
    toast("Save failed — check internet and try again", true);
  }
  btn.disabled = false;
  refresh();
}

async function refreshVideoList() {
  const list = $("videoList");
  try {
    videoRows = await sb("/" + T_VIDEOS + "?select=id,title,updated_at&order=updated_at.desc") || [];
  } catch (e) {
    console.error(e);
    list.innerHTML = "<div class='emptylist'>⚠ Could not load the list — check internet and hit Refresh.</div>";
    return;
  }
  if (!videoRows.length) {
    list.innerHTML = "<div class='emptylist'>No saved videos yet — fill Step 1 and hit ☁ Save video.</div>";
    return;
  }
  list.innerHTML = videoRows.map(r =>
    "<div class='vrow" + (r.id === video.id ? " current" : "") + "' data-id='" + r.id + "'>" +
      "<div class='vmeta'><b>" + esc(r.title) + "</b>" +
      "<span>" + (r.id === video.id ? "● currently loaded — " : "") +
      "updated " + new Date(r.updated_at).toLocaleString() + "</span></div>" +
      "<button class='load'>Load</button><button class='del'>Delete</button>" +
    "</div>").join("");
  list.querySelectorAll(".vrow").forEach(row => {
    const id = row.dataset.id;
    const title = videoRows.find(r => r.id === id).title;
    row.querySelector(".load").addEventListener("click", () => loadVideo(id, title));
    row.querySelector(".del").addEventListener("click", () => deleteVideo(id, title));
  });
}

async function loadVideo(id, title) {
  if (dirty && !confirm("You have unsaved changes on the current video.\nLoad \"" + title + "\" anyway and lose them?")) return;
  try {
    const rows = await sb("/" + T_VIDEOS + "?id=eq." + encodeURIComponent(id) + "&select=*");
    if (!rows || !rows[0]) { toast("Video not found — refresh the list", true); return; }
    const r = rows[0];
    video = { id: r.id, title: r.title, keyPoints: r.key_points, voScript: r.vo_script,
              done: r.done || {}, step: r.current_step || "s1" };
    dirty = false;
    fillVideoInputs();
    toast("Loaded \"" + r.title + "\" — continuing at step " + video.step.slice(1));
    go(video.step);
    refreshVideoList();
  } catch (e) {
    console.error(e);
    toast("Load failed — check internet", true);
  }
}

async function deleteVideo(id, title) {
  if (!confirm("Delete \"" + title + "\" from the cloud?\nThis cannot be undone.")) return;
  try {
    await sb("/" + T_VIDEOS + "?id=eq." + encodeURIComponent(id), { method: "DELETE" });
    if (video.id === id) { video.id = null; dirty = true; }
    toast("Deleted \"" + title + "\"");
    await refreshVideoList();
    refresh();
  } catch (e) {
    console.error(e);
    toast("Delete failed — check internet", true);
  }
}

/* ================= rendering ================= */
const STEP_IDS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"];

function refresh() {
  document.querySelectorAll(".navstep").forEach(el => {
    const id = el.dataset.step;
    el.classList.toggle("active", id === currentPanel);
    const done = id === "setup" ? settings.samples.some(s => s.trim()) : !!video.done[id];
    el.classList.toggle("done", done && id !== "ref" && id !== "videos");
    const dot = el.querySelector(".dot");
    if (el.classList.contains("done")) dot.textContent = "✓";
    else dot.textContent = id === "setup" ? "⚙" : id === "ref" ? "📖" : id === "videos" ? "📂" : id.slice(1);
  });

  const n = STEP_IDS.filter(id => video.done[id]).length;
  $("progressFill").style.width = (n / 9 * 100) + "%";
  $("progressLabel").textContent = n + " / 9 steps done";

  $("workLabel").innerHTML = "<span>Working on:</span> " + (esc(video.title.trim()) || "Untitled video");
  const saveBtn = $("saveVideoBtn");
  saveBtn.classList.toggle("dirty", dirty);
  if (!saveBtn.disabled) saveBtn.textContent = dirty ? "☁ Save video •" : "☁ Save video";

  document.querySelectorAll(".panel").forEach(p =>
    p.classList.toggle("active", p.id === "panel-" + currentPanel));

  const filled = settings.samples.filter(s => s.trim()).length;
  $("sampleStatus").className = "samplestatus " + (filled >= 2 ? "ok" : "missing");
  $("sampleStatus").textContent = filled >= 2
    ? "✓ " + filled + " sample scripts stored — used automatically in Step 1."
    : "⚠ Add at least 2 sample scripts so the AI can learn your tone.";

  $("durationNote").textContent = "Target duration: " + (settings.duration.trim() || "8-12")
    + " minutes — change it in Setup.";
  $("prompt1Out").value = buildPrompt1();
  $("prompt2Out").value = buildPrompt2();
  $("buildCmd").textContent = "py build_timeline.py --scale 72"
    + ($("withAudio").checked ? " --audio narration.wav" : "");
  renderStats();

  document.querySelectorAll(".donebtn").forEach(b => {
    const id = b.dataset.done;
    b.textContent = video.done[id]
      ? "✓ Step " + id.slice(1) + " done — click to undo"
      : "✓ Mark step " + id.slice(1) + " done";
    b.classList.toggle("secondary", !!video.done[id]);
  });
}

function go(panel) {
  currentPanel = panel;
  if (STEP_IDS.includes(panel)) video.step = panel;
  refresh();
  window.scrollTo({ top: 0 });
}

function fillVideoInputs() {
  $("vidTitle").value = video.title;
  $("keyPoints").value = video.keyPoints;
  $("voScript").value = video.voScript;
}

/* ================= toast + copy ================= */
function toast(msg, isErr) {
  const t = $("toast");
  t.textContent = msg;
  t.className = isErr ? "err show" : "show";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}
function copyText(text) {
  const done = () => toast("Copied ✓");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => { fallbackCopy(text); done(); });
  } else { fallbackCopy(text); done(); }
}
function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); } catch (e) {}
  ta.remove();
}

/* ================= events ================= */
function bindEvents() {
  document.querySelectorAll(".navstep").forEach(el =>
    el.addEventListener("click", () => go(el.dataset.step)));
  document.querySelectorAll("[data-go]").forEach(b =>
    b.addEventListener("click", () => go(b.dataset.go)));

  [["sample1", 0], ["sample2", 1], ["sample3", 2]].forEach(([id, i]) => {
    $(id).addEventListener("input", () => {
      settings.samples[i] = $(id).value; queueSettingsSave(); refresh();
    });
  });
  $("duration").addEventListener("input", () => {
    settings.duration = $("duration").value; queueSettingsSave(); refresh();
  });

  [["vidTitle", "title"], ["keyPoints", "keyPoints"], ["voScript", "voScript"]].forEach(([id, key]) => {
    $(id).addEventListener("input", () => {
      video[key] = $(id).value; dirty = true; refresh();
    });
  });

  $("withAudio").addEventListener("change", refresh);
  $("copyPrompt1").addEventListener("click", () => copyText(buildPrompt1()));
  $("copyPrompt2").addEventListener("click", () => copyText(buildPrompt2()));
  $("copyBuildCmd").addEventListener("click", () => copyText($("buildCmd").textContent));
  document.querySelectorAll("[data-copy]").forEach(b =>
    b.addEventListener("click", () => copyText(b.dataset.copy)));

  document.querySelectorAll(".donebtn").forEach(b =>
    b.addEventListener("click", () => {
      const id = b.dataset.done;
      video.done[id] = !video.done[id];
      if (!video.done[id]) delete video.done[id];
      dirty = true; refresh();
      saveVideo();
    }));

  $("saveVideoBtn").addEventListener("click", saveVideo);
  $("refreshVideosBtn").addEventListener("click", refreshVideoList);

  $("newVideoBtn").addEventListener("click", () => {
    if (dirty && !confirm("You have unsaved changes on the current video.\nStart a new one anyway and lose them?")) return;
    video = blankVideo();
    dirty = false;
    fillVideoInputs();
    go("s1");
    refreshVideoList();
  });

  window.addEventListener("beforeunload", e => {
    if (dirty) { e.preventDefault(); e.returnValue = ""; }
  });
}

/* ================= boot ================= */
async function boot() {
  bindEvents();
  refresh();
  try {
    const rows = await sb("/" + T_SETTINGS + "?id=eq.1");
    if (rows && rows[0]) {
      settings.samples = Array.isArray(rows[0].samples) ? rows[0].samples : ["", "", ""];
      while (settings.samples.length < 3) settings.samples.push("");
      settings.duration = rows[0].duration || "8-12";
    }
    setCloudStatus("✓ Cloud connected (YT Automation)", "ok");
  } catch (e) {
    console.error(e);
    setCloudStatus("⚠ Can't reach Supabase — check your internet, then reload the page.", "err");
  }
  $("sample1").value = settings.samples[0];
  $("sample2").value = settings.samples[1];
  $("sample3").value = settings.samples[2];
  $("duration").value = settings.duration;
  fillVideoInputs();
  refresh();
  refreshVideoList();
}
boot();
