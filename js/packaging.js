"use strict";
/* ================= Packaging Lab tab ================= */

let pkgPreview = { thumb: null };   // the feed preview's title lives in #pkgPrevTitle

function packagingInit() {
  $("pkgPromptBtn").addEventListener("click", pkgBuildPrompt);
  $("pkgPromptCopy").addEventListener("click", () => copyText($("pkgPromptOut").value));
  $("pkgPromptMode").addEventListener("change", pkgModeHint);
  $("pkgScript").addEventListener("input", pkgScriptCount);
  $("pkgPrevTitle").addEventListener("input", pkgPrevTitleInput);
  $("pkgThumbFile").addEventListener("change", pkgThumbPicked);
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
   script (it still has the script AND my sample scripts in context, so the titles sound
   most like me), "fresh" embeds the whole script for a new chat — a more neutral judge of
   whether a title's promise is really kept, since it did not write the script itself. */

/* The image-prompt scaffolding travels as a fill-in template, and the instructions below
   insist the fixed lines are reproduced word-for-word, so the reference-image clause and
   the FORMAT/AVOID guardrails come out the same on every run regardless of what Claude
   fills into the slots. */
const PKG_THUMB_TEMPLATE = [
"Create a 16:9 YouTube thumbnail image.",
"",
"CHARACTER: use the character in the uploaded reference image as the only person in the frame. Keep their face, hat, scarf, outfit, art style, line weight, colours and proportions exactly as in the reference — do not redesign, restyle, age or re-draw them in a different style. {{POSE}}",
"SCENE: {{SCENE}}",
"COMPOSITION: {{COMPOSITION}}",
"COLOUR & LIGHT: {{PALETTE}}",
"TEXT: {{TEXT}}",
"FORMAT: 1280x720. It has to read instantly at 210x118 px on a phone: one subject, one idea, the character's face big enough that the emotion is legible, hard separation between subject and background.",
"AVOID: a second person or any duplicate of the character, invented numbers or statistics, fake screenshots, fake logos or brand marks, garbled or extra lettering, watermarks, cluttered backgrounds, red circles, arrows, exaggerated shock or open-mouth screaming faces, and anything the video does not actually deliver.",
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
"- {{SCENE}}: the background, setting and any objects, in one or two sentences. Real props from the script beat abstract shapes.",
"- {{COMPOSITION}}: where the character sits in the 16:9 frame, how tight the crop is, and which region stays empty for the text.",
"- {{PALETTE}}: colours and lighting in one sentence — high contrast, one dominant accent colour, nothing muddy.",
"- {{TEXT}}: max 4 words of overlay. If the thumbnail has words, write: render exactly these words and no others — \"MY WORDS\". Heavy bold condensed sans-serif, all caps, one or two lines, with a thin dark outline or drop shadow so it separates from whatever is behind it. Spell it letter-for-letter as written. — If the image is stronger with no text, write instead: no words anywhere in the image — leave the negative space clean so I can add the text myself.",
"- Leave the FORMAT and AVOID lines exactly as written. 210x118 px is the real size of a thumbnail in a phone feed, which is where most of my impressions happen, and the AVOID list is what keeps my thumbnails out of clickbait territory.",
  ].join("\n");
}

function buildPackagingPrompt(o) {
  const sameChat = o.mode !== "fresh";
  const title = (o.title || "").trim() || "(!! fill in the video title above !!)";
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
"MY WORKING TITLE: " + title,
notes ? "EXTRA NOTES FROM ME: " + notes : null,   // null, not "" — "" is a real blank line
"",
  ].concat(scriptBlock, [
"",
"--- WHAT I WANT ---",
"",
"1. FIFTEEN TITLE OPTIONS, best first.",
"- Mix proven patterns: curiosity gap, negativity or warning, numbers, transformation, direct benefit, contrarian.",
"- Max about 60 characters each where possible. Beat my working title — do not just reword it.",
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
"- Titles: a numbered list. Put the title on its own line so I can copy it cleanly, with the score, the hook and the quoted script line around it.",
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
  const title = $("pkgTopic").value.trim();
  const script = $("pkgScript").value.trim();
  if (!title) { toast("Paste the video title first", true); return; }
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
