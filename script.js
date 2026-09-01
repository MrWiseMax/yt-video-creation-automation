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
let settings = { duration: "8-12" };
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
/* Shared voice-over-script building blocks — reused by the Setup workflow (buildPrompt1)
   AND the Radar "📝 Script from this video" workflow (js/radar.js), so both produce a
   file with the EXACT same format the recording/editing pipeline depends on. */
/* The channel's fixed self-introduction. It is beat 3 of every script, word for
   word, and it arrives already split into breath-lines so the format rules below
   never have to re-break it. Three pillars, one ask: it does not grow, and a
   fourth topic would replace one of the three rather than join them. */
const CHANNEL_INTRO_LINES = [
"Hi, I'm Max.",
"This channel is about finance, self-improvement, and business.",
"If you're interested, hit subscribe.",
];

/* The channel voice, stated outright.

   This used to be inferred from pasted sample scripts, which had two problems: a
   sample teaches delivery but says nothing about STRUCTURE, and "sound like this"
   drifts a little further on every re-inference. Naming the qualities is shorter
   and more stable, and it leaves the spine below to own the shape. */
function voToneBlock() {
  return [
"--- VOICE ---",
"- Calm, direct and certain. Never hyped, never a salesman, never a guru. The confidence comes from knowing the subject, not from volume.",
"- Write for the ear, not the eye: contractions, direct address (\"you\"), short declarative sentences, concrete everyday examples.",
"- Plain words over impressive ones. If a smart teenager would not know the word, either use a simpler one or explain it in the same breath.",
"- Specific always beats general. Real numbers, real objects, real situations. Treat every adjective as a specific you have not found yet: 'seventy-one thousand dollars' lands, 'cheap' does not.",
"- Talk to one person, never to a crowd. No 'guys', no 'everyone', no 'you all'.",
"- Respect the viewer. Whenever you correct a belief, first explain why holding it was reasonable. Contempt loses the person who holds it, and that is everyone watching.",
"- No filler openers ('in this video', 'let's dive in', 'without further ado'), and no self-reference: nothing in the script mentions the script, the video or the channel except in the fixed lines given in the story structure above.",
  ];
}

/* The channel's story structure - the spine every script is built on.

   ONE array, TWO consumers: voStructureBlock() turns it into prompt text for
   both script builders, and renderSpine() draws it on the Setup page as a
   reminder. Editing a beat here moves both, which is the whole point - a
   reminder card that has quietly drifted from the prompt it claims to describe
   is worse than no card at all.

   `prompt` is what the model reads; `gist` is the one-line version for the card.
   Shares are of the TOTAL word count, not minutes: the target length changes
   from video to video, the proportions do not. */
const STORY_SPINE = [
  {
    n: 1, name: "The anomaly", share: "2%",
    gist: "One concrete fact that sounds slightly wrong, left unexplained. No greeting, no throat-clearing.",
    prompt: "Open on one concrete fact that sounds slightly wrong, and leave it unexplained. This is the loop the whole video exists to close, so it has to be specific and real: a number, a place, a thing somebody actually did. No greeting, no channel name, no throat-clearing of any kind. The first word of the script is the first word of the story.",
  },
  {
    n: 2, name: "What I did", share: "3%",
    gist: "The work behind the video, with a number in it. Credibility, not a boast.",
    prompt: "The work behind the video, with a NUMBER in it. 'I went through three hundred and forty sales' buys the next ten minutes; 'I did a lot of research' buys nothing. State it plainly and move on - this is credibility, not a boast.",
  },
  {
    n: 3, name: "Who I am", share: "fixed",
    gist: "The self-introduction, word for word, in every video:",
    prompt: "Output these three lines EXACTLY as written, word for word, as three consecutive breath-lines, and never repeat this idea anywhere else in the script:",
    lines: CHANNEL_INTRO_LINES,
  },
  {
    n: 4, name: "The promise", share: "3%",
    gist: "What the viewer will be able to DO by the end - a change in them, never a contents list.",
    prompt: "What the viewer will be able to DO by the end. State it as a change in THEM, never as a table of contents: 'you will be able to look at any street and tell which houses actually make money' - never 'I will cover five things'. A list of contents is a menu, and a menu invites the viewer to skip ahead to their course.",
  },
  {
    n: 5, name: "The wrong model", share: "9%",
    gist: "What everybody believes, at its most convincing. This is the tension engine.",
    prompt: "What almost everybody believes about this topic, stated SYMPATHETICALLY and at its strongest. The gap between this and the truth is the tension carrying the whole video, so make the wrong idea genuinely appealing first. A viewer who feels mocked for believing it leaves; a viewer who feels understood has to know what is actually true.",
  },
  {
    n: 6, name: "The body", share: "60%",
    gist: "3-5 moves, each revealing the last was incomplete. Spend one on why the myth persists.",
    prompt: "Three to five moves, each one revealing that the previous move was incomplete. Move 2 makes move 1 look partial. Move 3 makes the viewer re-see move 1. That escalation is the entire difference between a story and a list: a flat set of parallel points lets the viewer leave after any one of them, because each one finished. Never end a move on a settled full stop - end it on the question the next move answers. Somewhere in here, spend one move on WHY THE MYTH PERSISTS: who benefits from people believing the wrong thing. It is the strongest single move available on this subject matter and it is almost always the one missing.",
  },
  {
    n: 7, name: "The turn", share: "9%",
    gist: "Back to the anomaly, answered in full. Replaces a recap and must never become one.",
    prompt: "Return to the anomaly from beat 1 and answer it completely, now that the viewer has everything needed to understand it. This replaces a recap and must never become one: a recap tells the viewer they have it all and may leave, which is the last thing to say here. Same consolidating job, opposite effect - it pays the opening off instead of releasing the tension.",
  },
  {
    n: 8, name: "So what", share: "9%",
    gist: "Into the viewer's own life, small enough to do this week. One action, not five.",
    prompt: "Put it into the viewer's own life, concrete and small enough that they could act on it this week. ONE action, not five. Five actions is zero actions.",
  },
  {
    n: 9, name: "The send-off", share: "4%",
    gist: "No summary. Open a new loop - the question this video left unanswered - and stop.",
    prompt: "Do NOT summarise. End by opening a NEW loop: the question this video deliberately left unanswered, the thing that comes next. One or two lines, then stop.",
  },
];

function voStructureBlock() {
  const out = [
"--- STORY STRUCTURE (the spine - follow it exactly, in this order) ---",
"- Every script has these NINE beats, always in this order. The percentages are shares of the TOTAL word count, so scale them to the target length given above.",
"- CRITICAL: these beat names are architecture, not text. Never write a beat name, heading, number, label or section break into the script itself. The finished script is one continuous spoken piece and the viewer must never hear a seam.",
  ];
  STORY_SPINE.forEach(b => {
    out.push("", b.n + ". " + b.name.toUpperCase() + " - " + b.share + ". " + b.prompt);
    if (b.lines) out.push.apply(out, [""].concat(b.lines));
  });
  return out;
}

/* The Setup page's reminder card. Reads the same array the prompt is built from,
   so it cannot describe a spine the prompt is not actually asking for. */
function renderSpine() {
  const box = $("spineList");
  if (!box) return;
  box.innerHTML = STORY_SPINE.map(b =>
    "<li class='beat'>" +
      "<span class='beat-n'>" + b.n + "</span>" +
      "<div class='beat-body'>" +
        "<div class='beat-head'><b>" + esc(b.name) + "</b>" +
          "<span class='beat-share'>" + esc(b.share) + "</span></div>" +
        "<div class='beat-gist'>" + esc(b.gist) + "</div>" +
        (b.lines ? "<div class='beat-lines'>" + esc(b.lines.join("\n")) + "</div>" : "") +
      "</div>" +
    "</li>").join("");
}

function voFormatBlock() {
  return [
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
  ];
}

function voOutputBlock() {
  return [
"--- WHAT TO OUTPUT (read carefully) ---",
"- Go straight to creating a downloadable .txt file named exactly voice-over-script.txt containing the full script, formatted exactly as above.",
"- Do NOT print the script text in the chat reply itself - it belongs ONLY inside the file. After the file is created you may add one short confirmation sentence, nothing more.",
"- ONLY IF your tool is genuinely unable to create downloadable files: then output the full script as plain chat text instead, in the exact same format, as a fallback.",
"",
"Now write the full script.",
  ];
}

function buildPrompt1() {
  const title = video.title.trim() || "(!! fill in the video title / idea above !!)";
  const points = video.keyPoints.trim() || "(!! fill in the key points above !!)";
  const dur = settings.duration.trim() || "8-12";
  return [
"You are a professional YouTube scriptwriter. Write a complete, ready-to-record voice-over script for my next video, in my channel's voice and built on my channel's story structure - both are defined in full below.",
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
  ].concat(voStructureBlock(), [""], voToneBlock(),
           [""], voFormatBlock(), [""], voOutputBlock()).join("\n");
}

function buildPrompt2() {
  const script = video.voScript.trim() || "(!! paste your voice-over script above !!)";
  return [
"You are creating image-generation prompts for a YouTube video. The script below is split into short breath-lines. Group the lines into scenes of EXACTLY TWO CONSECUTIVE LINES each - one scene = one image = two breath-lines combined. If the script has an odd number of lines, the LAST scene may contain just the final single line. Do not merge non-consecutive lines, do not split a pair of lines across two scenes, do not skip lines, and never reword a line.",
"",
"--- CHARACTER & STYLE (applies to every prompt) ---",
"- Every prompt starts with: \"Use the character from the uploaded image reference.\" Then describe this scene.",
"- In each prompt describe: the character's action, pose and expression that visually acts out BOTH lines of the scene together as one moment; the setting; 3-5 concrete environment details; and the overall energy in a short closing phrase.",
"- Grounded, relatable body language - never exaggerated or slapstick. Never describe the character, the other people or the setting as \"realistic\" or photorealistic, and never write toward photoreal rendering, photography, a cinematic film still or a 3D render - keep the established illustrated character look. No glow.",
"- THE WHOLE FRAME IS DRAWN, not just the character. The setting, buildings, streets, rooms, furniture and props are all flat 2D illustration in the same style, line weight and colouring as the character reference. Never a photographic background with a drawn character placed on top of it - that mismatch is the single worst failure here.",
"- THE ENVIRONMENT IS FULLY COLOURED, exactly as solidly as the character is. Name real colours for the surfaces and the objects in the scene - wood browns, painted walls, coloured packaging, metal greys, tiled floors, whatever that place actually contains. A washed-out beige, sepia, greyscale or near-monochrome background is a FAILURE, and so is a setting drawn as pale outlines sitting behind a fully coloured character. If the character is the only thing in the frame carrying real colour, the scene is wrong.",
"- FURNISH THE PLACE so it reads as somewhere real and lived-in, not a stage. Name the location, then the specific things that belong in it: furniture, tools, jars and boxes with coloured labels, plants, appliances, signage, clutter on a shelf. Concrete named objects beat vague phrases like \"a cozy room\" every time - they are what makes a scene look designed rather than empty.",
"- A PLAIN WHITE OR EMPTY BACKGROUND is allowed ONLY when the two lines are genuinely about no place at all - a pure abstraction with nothing around it. That is rare, a handful of scenes at most in a whole video. If the lines could happen anywhere real - a kitchen, a street, a shop, an office, a garage - put the character in that place and furnish it as above.",
"- NEVER describe lighting mood or quality, in any form. This is banned: \"soft afternoon light\", \"warm late-afternoon lighting\", \"warm golden light\", \"soft golden light\", \"warm morning window light\", \"light from a window\", \"sunlit kitchen\", or any other \"[mood] light/lighting\" or \"sunlit ___\" phrase. Do not swap in a different lighting descriptor either - just leave lighting out completely. This bans LIGHTING, not colour: the scene is still fully and richly coloured, it simply is not lit from anywhere in particular. Let the action, pose and setting alone make the two lines' meaning clear.",
"- Favor environment variety scene-to-scene so the setting actually matches what THIS scene's two lines are about, instead of defaulting to the same room/background out of habit. Only keep the exact same setting as the previous scene when the two lines are clearly a continuous moment in that same place; otherwise transition to a new, ordinary, everyday location (a different room, indoors vs outdoors, a different spot in the same space) that fits the new lines.",
"- Vary the character's relationship to the camera across the video - rotate through all three of these rather than defaulting to one: (a) face visible, NOT looking at the camera; (b) face visible, looking directly at the camera; (c) character seen from behind or the side so the face is not visible, not looking at the camera. Pick whichever fits each scene's meaning.",
"- When it fits the scene, you may add one or two side/background characters doing something plausible in the environment. Draw them in exactly the same flat 2D illustrated style as the main character - same line weight, same simple drawn faces - never photorealistic people sharing the frame with an illustrated one. Give them the same general body build as the main character but explicitly NO hat and NO scarf, so the main character stays visually unique in every frame.",
"- END EVERY PROMPT with this exact sentence, word for word, as its final sentence:   Avoid using realistic environment look and avoid using realistic characters.",
"  It goes in all of them, every single scene, never reworded, never shortened, never skipped.",
"- 60-100 words per prompt, not counting that fixed final sentence. The extra room over a bare description is there to be spent on the environment: name its colours and its objects.",
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
"Use the character from the uploaded image reference. The character stands at a bathroom mirror, fists lightly clenched at chest height, face visible but eyes on their own reflection rather than the camera, a determined, hopeful expression - the look of someone starting fresh. The whole bathroom is drawn and fully coloured in the same flat illustrated style: mint-green wall tiles, a white basin with chrome taps, a red toothbrush in a blue cup, a folded yellow towel on a wooden rail, a yellow sticky note stuck to the mirror edge. Motivated, energetic energy. Avoid using realistic environment look and avoid using realistic characters.",
"",
"SCENE 2",
"",
"\"Then three days later, back to zero. And I always blamed myself for it.\"",
"",
"Use the character from the uploaded image reference. The character sits slumped on the edge of a bed in a different, messier room, back turned to the camera so the face isn't visible, shoulders low, the yellow sticky note now crumpled in one hand. The room is drawn and fully coloured in the same flat illustrated style: a navy duvet half off the mattress, warm brown floorboards, a grey hoodie thrown over a wooden chair, a cluttered bedside table with a phone and a half-full mug, a laundry basket overflowing in the corner. Deflated, self-critical energy. Avoid using realistic environment look and avoid using realistic characters.",
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
        body: JSON.stringify({ duration: settings.duration })
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
const STEP_IDS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"];

function refresh() {
  document.querySelectorAll(".navstep").forEach(el => {
    const id = el.dataset.step;
    el.classList.toggle("active", id === currentPanel);
    const done = id === "setup" ? !!settings.duration.trim() : !!video.done[id];
    el.classList.toggle("done", done && id !== "ref" && id !== "videos");
    const dot = el.querySelector(".dot");
    if (el.classList.contains("done")) dot.textContent = "✓";
    else dot.textContent = id === "setup" ? "⚙" : id === "ref" ? "📖" : id === "videos" ? "📂" : id.slice(1);
  });

  const n = STEP_IDS.filter(id => video.done[id]).length;
  $("progressFill").style.width = (n / STEP_IDS.length * 100) + "%";
  $("progressLabel").textContent = n + " / " + STEP_IDS.length + " steps done";

  $("workLabel").innerHTML = "<span>Working on:</span> " + (esc(video.title.trim()) || "Untitled video");
  const saveBtn = $("saveVideoBtn");
  saveBtn.classList.toggle("dirty", dirty);
  if (!saveBtn.disabled) saveBtn.textContent = dirty ? "☁ Save video •" : "☁ Save video";

  document.querySelectorAll(".panel").forEach(p =>
    p.classList.toggle("active", p.id === "panel-" + currentPanel));

  $("durationNote").textContent = "Target duration: " + (settings.duration.trim() || "8-12")
    + " minutes — change it in Setup.";
  $("prompt1Out").value = buildPrompt1();
  $("prompt2Out").value = buildPrompt2();
  $("buildCmd").textContent = "py pipeline.py build --scale 72";
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

/* ================= top-level tabs ================= */
function goTopTab(tab) {
  document.querySelectorAll(".toptab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tabpanel").forEach(p => p.classList.toggle("active", p.id === "tab-" + tab));
}

/* ================= events ================= */
function bindEvents() {
  document.querySelectorAll(".toptab").forEach(el =>
    el.addEventListener("click", () => goTopTab(el.dataset.tab)));
  document.querySelectorAll(".navstep").forEach(el =>
    el.addEventListener("click", () => go(el.dataset.step)));
  document.querySelectorAll("[data-go]").forEach(b =>
    b.addEventListener("click", () => go(b.dataset.go)));

  $("duration").addEventListener("input", () => {
    settings.duration = $("duration").value; queueSettingsSave(); refresh();
  });

  [["vidTitle", "title"], ["keyPoints", "keyPoints"], ["voScript", "voScript"]].forEach(([id, key]) => {
    $(id).addEventListener("input", () => {
      video[key] = $(id).value; dirty = true; refresh();
    });
  });

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
  renderSpine();
  refresh();
  try {
    const rows = await sb("/" + T_SETTINGS + "?id=eq.1");
    if (rows && rows[0]) {
      settings.duration = rows[0].duration || "8-12";
    }
    setCloudStatus("✓ Cloud connected (YT Automation)", "ok");
  } catch (e) {
    console.error(e);
    setCloudStatus("⚠ Can't reach Supabase — check your internet, then reload the page.", "err");
  }
  $("duration").value = settings.duration;
  fillVideoInputs();
  refresh();
  refreshVideoList();
}
boot();
