"use strict";
/* ================= Packaging Lab tab ================= */

let pkgPreview = { thumb: null };   // the feed preview's title lives in #pkgPrevTitle
let pkgTitles = [];                 // lifted out of the reply pasted into #pkgReply
let pkgChosen = "";

function packagingInit() {
  $("pkgPromptBtn").addEventListener("click", pkgBuildPrompt);
  $("pkgPromptCopy").addEventListener("click", () => copyText($("pkgPromptOut").value));
  $("pkgPromptMode").addEventListener("change", pkgModeHint);
  $("pkgScript").addEventListener("input", pkgScriptCount);
  $("pkgPrevTitle").addEventListener("input", pkgPrevTitleInput);
  $("pkgThumbFile").addEventListener("change", pkgThumbPicked);
  $("pkgReply").addEventListener("input", pkgReplyInput);
  pkgModeHint();
  pkgScriptCount();
}

function pkgScriptCount() {
  const t = $("pkgScript").value.trim();
  const n = t ? t.split(/\s+/).length : 0;
  $("pkgScriptCount").textContent = n
    ? "— " + fmtNum(n) + " words (~" + (n / 160).toFixed(1) + " min of speech)"
    : "— required, empty right now";
}

/* ================= packaging prompt builder =================
   Builds a ready-to-paste packaging brief for me to run in a Claude chat myself — no API
   call from this app. Two modes: "continue" carries on the chat that just wrote the
   script (it still has the script AND my channel's voice and structure rules in context,
   so the titles sound most like me), "fresh" embeds the whole script for a new chat — a more neutral judge of
   whether a title's promise is really kept, since it did not write the script itself.

   The working title is optional. I usually finish the whole video before I name it, so
   with no title the brief asks Claude to FIND the title in the finished script instead
   of beating one; either way the reply's titles land in the picker below. */

/* The image-prompt scaffolding travels as a fill-in template, and the instructions below
   insist the fixed lines are reproduced word-for-word, so the reference-image clause and
   the FORMAT/AVOID guardrails come out the same on every run regardless of what Claude
   fills into the slots. */
const PKG_THUMB_TEMPLATE = [
"Create a 16:9 YouTube thumbnail image.",
"",
"CHARACTER: use the character in the uploaded reference image as the only person in the frame. Keep their face, hat, scarf, outfit, art style, line weight, colours and proportions exactly as in the reference — do not redesign, restyle, age or re-draw them in a different style. {{POSE}}",
"STYLE: the entire image is flat 2D illustration in the same drawing style, line weight and colouring as the character reference. The background, setting, furniture and every prop are drawn too — never a photograph, a photo-real environment, or a 3D render with an illustrated character placed on top of it.",
"SCENE: {{SCENE}}",
"COMPOSITION: {{COMPOSITION}}",
"COLOUR & LIGHT: {{PALETTE}}",
"TEXT: {{TEXT}}",
"FORMAT: 1280x720. It has to read instantly at 210x118 px on a phone: one subject, one idea, the character's face big enough that the emotion is legible, hard separation between subject and background.",
"AVOID: photographic or photo-real backgrounds, realistic-looking people, a second person or any duplicate of the character, invented numbers or statistics, fake screenshots, fake logos or brand marks, garbled or extra lettering, watermarks, cluttered backgrounds, red circles, arrows, exaggerated shock or open-mouth screaming faces, and anything the video does not actually deliver.",
].join("\n");

function pkgThumbTemplateBlock() {
  return [
"--- THUMBNAIL PROMPT TEMPLATE ---",
"",
"Every thumbnail prompt you give me must use this exact template. Reproduce every line word-for-word and replace ONLY the {{SLOTS}}:",
"",
PKG_THUMB_TEMPLATE,
"",
"Filling the slots:",
"- {{POSE}}: only what the character is DOING — pose, expression, eyeline, hands, where they look. Never describe their face, clothes, hat, scarf, age or art style; the reference image owns all of that, and a text description fighting the reference is what makes generators drift off-model.",
"- {{SCENE}}: the background, setting and any objects, in one or two sentences, all of it drawn in the same illustrated style as the character. Concrete props from the script beat abstract shapes.",
"- {{COMPOSITION}}: where the character sits in the 16:9 frame, how tight the crop is, and which region stays empty for the text.",
"- {{PALETTE}}: colours and lighting in one sentence — high contrast, one dominant accent colour, nothing muddy.",
"- {{TEXT}}: max 4 words of overlay. If the thumbnail has words, write: render exactly these words and no others — \"MY WORDS\". Heavy bold condensed sans-serif, all caps, one or two lines, with a thin dark outline or drop shadow so it separates from whatever is behind it. Spell it letter-for-letter as written. — If the image is stronger with no text, write instead: no words anywhere in the image — leave the negative space clean so I can add the text myself.",
"- Leave the STYLE, FORMAT and AVOID lines exactly as written. STYLE is what stops a drawn character being pasted onto a photographic background, 210x118 px is the real size of a thumbnail in a phone feed, which is where most of my impressions happen, and the AVOID list is what keeps my thumbnails out of clickbait territory.",
  ].join("\n");
}

function buildPackagingPrompt(o) {
  const sameChat = o.mode !== "fresh";
  const title = (o.title || "").trim();
  const script = (o.script || "").trim();
  const notes = (o.notes || "").trim();

  const scriptBlock = sameChat
    ? ["--- THE SCRIPT ---",
       "",
       "The finished voice-over script for this video is the one you just wrote for me above in this chat. That script is exactly what the viewer gets, so it is the only evidence of what the packaging is allowed to promise. Mine it for the concrete detail that sells the click: the specific number, the name, the surprising claim, the single strongest line."]
    : ["--- THE FINISHED VOICE-OVER SCRIPT ---",
       "",
       "This is exactly what the viewer gets, so it is the only evidence of what the packaging is allowed to promise. Mine it for the concrete detail that sells the click: the specific number, the name, the surprising claim, the single strongest line.",
       "",
       script || "(!! paste the voice-over script into the box above and rebuild this prompt !!)"];

  return [
"Act as a YouTube packaging expert — titles and thumbnails.",
"",
"Great packaging wins the click with a specific, emotionally charged promise the video actually keeps — curiosity, not deception. Packaging that over-promises buys one click and costs the channel a thousand: viewers bounce in the first 30 seconds, retention collapses, and YouTube stops recommending the video. So every option you produce has to be provably delivered by the script.",
"",
studioChannelBlock(),
"",
"--- MY RECENT VIDEO TITLES + VIEWS ---",
"",
"Learn my voice from these. Higher views roughly means stronger packaging for my audience.",
"",
studioMyTitlesBlock(25),
"",
"--- TITLES CURRENTLY OVER-PERFORMING IN MY NICHE ---",
"",
"Competitor outliers — these beat their own channel's baseline. Pattern inspiration only, never copy them.",
"",
studioOutlierBlock(15),
"",
"--- THIS VIDEO ---",
"",
title ? "MY WORKING TITLE: " + title
      : "MY WORKING TITLE: none yet. The video is finished and does not have a title — finding the best one is the main job here.",
notes ? "EXTRA NOTES FROM ME: " + notes : null,   // null, not "" — "" is a real blank line
"",
  ].concat(scriptBlock, [
"",
"--- WHAT I WANT ---",
"",
"1. FIFTEEN TITLE OPTIONS, best first.",
"- Mix proven patterns: curiosity gap, negativity or warning, numbers, transformation, direct benefit, contrarian.",
title
  ? "- Max about 60 characters each where possible. Beat my working title — do not just reword it."
  : "- Max about 60 characters each where possible. Find them in the script itself: start from the strongest promise the video actually keeps and the most concrete detail that sells it, and build the title around that.",
"- Score each 1-10 for expected click-through on MY channel, and give the psychological hook in one short line.",
"- For each title, quote the moment in the script that keeps that exact promise, in 15 words or less.",
"- If a title's promise is not actually kept by the script, leave it out and write a different one instead. An unbacked title is the one thing I do not want.",
"",
"2. THREE THUMBNAIL PROMPTS, best first, using the template below.",
"- Each one shows a moment, object or emotion that genuinely occurs in the script.",
"- I hand each finished prompt to an image generator together with a reference image of my character.",
"- Restraint is the point: no fake shock faces, no invented numbers, no arrows or red circles, nothing implying content the script does not contain. I want the look of a channel people trust, not one people feel tricked by.",
"",
"3. THE STRONGEST PAIRING — 2-3 sentences on which title and thumbnail work best together for this video, and why.",
"",
pkgThumbTemplateBlock(),
"",
"--- HOW TO REPLY ---",
"- Titles: a numbered list. Start each one with a line in exactly this shape and nothing else on it:   1. The Title Itself — 9/10   (the number, a full stop, the title with no quotes or bold around it, a dash, then the score out of 10). My app reads those lines to list the titles for me to pick from, so keep that shape exact. Put the hook and the quoted script line on the lines under it.",
"- Thumbnails: for each one, a short line naming the concept and its overlay text, a line on why it works and why it stays honest, then the finished prompt in its own fenced code block so I can copy it in one click.",
"- Do not ask me clarifying questions first unless something is genuinely ambiguous. Just deliver.",
  ]).filter(l => l !== null).join("\n");
}

function pkgModeHint() {
  const same = $("pkgPromptMode").value !== "fresh";
  $("pkgModeHint").textContent = same
    ? "Already in that chat's context, so it isn't re-pasted into the prompt below."
    : "Gets embedded in the prompt below in full.";
}

function pkgBuildPrompt() {
  const title = $("pkgTopic").value.trim();   // optional: empty = find me a title
  const script = $("pkgScript").value.trim();
  if (!script) { toast("Paste the full voice-over script first", true); return; }
  $("pkgPromptOut").value = buildPackagingPrompt({
    mode: $("pkgPromptMode").value,
    title: title,
    notes: $("pkgNotes").value,
    script: $("pkgScript").value,
  });
  const wrap = $("pkgPromptWrap");
  wrap.style.display = "block";
  wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ================= pick a title from Claude's reply =================
   The prompt pins each title's first line to "N. Title — S/10", which is what lets the
   titles be lifted out of an otherwise free-form reply. The pattern forgives what the
   Claude app's copy button tends to carry along (markdown bold, quotes, a heading mark,
   a bullet), and REQUIRES the "/10" score: the thumbnail list and the section headings
   are numbered too, and that score is the only thing that tells a title apart. */
const PKG_TITLE_RE =
  /^\s*(?:#{1,6}\s*)?(?:[-*]\s+)?(?:\*\*|__)?\s*(\d{1,2})\s*[.)]\s*(.+?)\s*(?:[—–-]{1,2}|\(|\|)\s*(?:\*\*)?\s*(?:score:?\s*)?(\d{1,2}(?:\.\d)?)\s*\/\s*10\b/i;

function pkgCleanTitle(t) {
  return t.replace(/\*\*|__/g, "").trim().replace(/^["“”'‘’]+|["“”'‘’]+$/g, "").trim();
}

/* [{ title, score, detail: up to 3 lines under it (the hook, the proving script line) }] */
function pkgParseTitles(text) {
  const out = [], seen = new Set();
  let cur = null;
  text.replace(/\r\n?/g, "\n").split("\n").forEach(line => {
    const m = line.match(PKG_TITLE_RE);
    if (m) {
      const title = pkgCleanTitle(m[2]);
      cur = null;
      if (!title || seen.has(title.toLowerCase())) return;
      seen.add(title.toLowerCase());
      cur = { title, score: m[3], detail: [] };
      out.push(cur);
      return;
    }
    if (!cur) return;
    const t = line.replace(/^\s*(?:[-*>]\s*)+/, "").replace(/\*\*|__/g, "").trim();
    if (!t) { if (cur.detail.length) cur = null; return; }   // a blank line closes the item
    if (cur.detail.length < 3) cur.detail.push(t); else cur = null;
  });
  return out;
}

function pkgReplyInput() {
  pkgTitles = pkgParseTitles($("pkgReply").value);
  renderPkgTitles();
}

function renderPkgTitles() {
  const list = $("pkgTitleList"), st = $("pkgReplyStatus");
  if (!$("pkgReply").value.trim()) {
    st.className = "settingsstatus"; st.textContent = ""; list.innerHTML = "";
    return;
  }
  if (!pkgTitles.length) {
    st.className = "settingsstatus err";
    st.textContent = "No titles found — the prompt asks for lines like  1. The Title Itself — 9/10 . " +
      "Paste the whole reply, or type any title straight into the feed preview below.";
    list.innerHTML = "";
    return;
  }
  st.className = "settingsstatus ok";
  st.textContent = pkgTitles.length + " titles found — click one to choose it.";
  list.innerHTML = pkgTitles.map((t, i) => {
    const n = [...t.title].length;
    const long = n > 60;   // past this a phone feed starts cutting it off
    const on = t.title === pkgChosen;
    return "<div class='tpick" + (on ? " on" : "") + "' data-i='" + i + "'>" +
      "<span class='tpscore'>" + esc(t.score) + "/10</span>" +
      "<div class='tpbody'><b>" + esc(t.title) + "</b>" +
        "<small" + (long ? " class='warn'" : "") + ">" + n + " characters" +
          (long ? " — may get cut off in the feed" : "") + "</small>" +
        (t.detail.length ? "<div class='tpdetail'>" + esc(t.detail.join("\n")) + "</div>" : "") +
      "</div>" +
      "<button type='button' class='sbtn'>" + (on ? "✓ Chosen" : "Choose") + "</button></div>";
  }).join("");
  list.querySelectorAll(".tpick").forEach(el =>
    el.addEventListener("click", () => pkgChooseTitle(pkgTitles[+el.dataset.i].title)));
}

/* Choosing = copied to the clipboard AND dropped into the feed preview, so the next thing
   I see is that title competing with real videos. Not copyText(): its own "Copied ✓"
   toast would land a moment later and cover this one. */
function pkgChooseTitle(title) {
  pkgChosen = title;
  renderPkgTitles();
  $("pkgPrevTitle").value = title;
  renderPkgPreview();
  const done = () => toast("Title chosen ✓ — copied, and it's in the feed preview below");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(title).then(done).catch(() => { fallbackCopy(title); done(); });
  } else { fallbackCopy(title); done(); }
}

function pkgThumbPicked() {
  const f = $("pkgThumbFile").files && $("pkgThumbFile").files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => { pkgPreview.thumb = rd.result; renderPkgPreview(); };
  rd.readAsDataURL(f);
}

/* Typing swaps only the title text — a full re-render would re-request the competitor
   thumbnails on every keystroke and flicker. */
function pkgPrevTitleInput() {
  const t = $("pkgPrevTitle").value.trim();
  const b = $("pkgPrevGrid").querySelector(".prevcard.mine b");
  if (t && b) { b.textContent = t; return; }
  renderPkgPreview();
}

function renderPkgPreview() {
  const title = $("pkgPrevTitle").value.trim();
  const grid = $("pkgPrevGrid");
  if (!title) { grid.innerHTML = ""; return; }
  const comp = studio.radarVideos
    .filter(v => !v.is_short && v.thumbnail_url)
    .sort((a, b) => (b.outlier_score || 0) - (a.outlier_score || 0))
    .slice(0, 5);
  const chanById = Object.fromEntries(studio.channels.map(c => [c.channel_id, c]));
  const mine =
    "<div class='prevcard mine'>" +
    (pkgPreview.thumb
      ? "<img class='pthumb' src='" + pkgPreview.thumb + "' alt=''>"
      : "<div class='pthumb'>your thumbnail here</div>") +
    "<b>" + esc(title) + "</b><span>" +
    esc((studio.settings && studio.settings.my_channel_title) || "Your channel") + " · just now</span></div>";
  const cards = comp.map(v =>
    "<div class='prevcard'><img class='pthumb' loading='lazy' src='" + esc(v.thumbnail_url) + "' alt=''>" +
    "<b>" + esc(v.title) + "</b><span>" + esc((chanById[v.channel_id] || {}).title || "") + " · " +
    fmtNum(v.view_count) + " views</span></div>");
  cards.splice(1, 0, mine); // your video in slot 2 of the fake feed
  grid.innerHTML = cards.join("");
}
