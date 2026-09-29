"use strict";
/* ================= MG Prompt Gen tab =================
   Motion-graphics clips for Google Flow. The request, the one-time Claude Project
   instructions and the finished Flow prompts are all built here in the browser for me
   to paste into the Claude app - nothing on this tab calls an API.

   Moved in from the standalone "MG Prompt Gen" page. The prompt text below is that
   page's, unchanged. It all sits inside one function scope because its names (STYLE,
   fmt, NAMES, update...) are generic enough to collide with script.js's globals; it
   reuses $() and copyText() from there. The character icon is my-own-character.jpg,
   next to index.html. */
(function () {

// ---------- Fixed parts the app adds around Claude's scenes ----------
// STYLE comes first and the character after it: this order matched the reference best.

const STYLE = 'STYLE: Vintage editorial collage motion graphics. Background is a light grey paper-textured wall with a heavy dark vignette at the edges, a soft spotlight in the center, and fine film grain. All people and objects are black-and-white 1950s photo cutouts with crisp paper edges, soft drop shadows and layered parallax depth. The palette is monochrome grey except for two accent colors: bold red and navy blue. Typography: a small thin uppercase serif line above a large heavy condensed uppercase black headline; some words appear in slightly tilted black sticker boxes with white condensed letters. Text reveals with a letter-scramble effect, letters popping in randomly. Thin hand-drawn lines and arrows draw themselves on. The camera does a constant slow push-in, with snappy whip-pan and zoom-through transitions, and elements slide in from off-frame with overshoot easing.';

const OPENING = 'The video begins exactly on the provided start frame image: same scene, same on-screen text, same composition, lighting and camera position. Hold it for 0.3 seconds, then continue the motion seamlessly from it.';

// Silent on purpose: every sound is designed by hand in Premiere, so anything the model
// generated would only be muted there. Said outright, because a prompt that leaves audio
// out gets whatever sound the model picks.
const AUDIO = 'AUDIO: Completely silent. No sound at all: no voiceover, no dialogue, no music and no sound effects.';

const MASCOT_DESC = 'a round white head with small black dot eyes and a gentle smile, a black fedora with a white band, a tan-brown scarf, a plain white body with thin limbs, a black wristband on the left wrist, and thick clean black outlines. Keep its exact design in every scene. It is the only non-photo element in the collage: a flat paper cutout with only a hairline white edge and a soft drop shadow, no thick white border. It moves like a paper cutout puppet, and its tan-brown scarf is the only extra color.';

const MAN_DESC = 'a 1950s office worker in a dark suit, white shirt, thin tie and fedora hat, black-and-white photo cutout. Same man in every scene.';

// "first" = Video 1, "same" = same character as the start frame, "switch" = the character changes here.
const CHARACTER_BLOCKS = {
  own: {
    first: `THE CHARACTER: the flat 2D cartoon mascot from the reference image (ignore that image's white background): ${MASCOT_DESC}`,
    same: `THE CHARACTER: the same flat 2D cartoon mascot from the start frame: ${MASCOT_DESC}`,
    switch: `THE CHARACTER: the man in the start frame exits during the opening transition and does not come back. Then the main character is the flat 2D cartoon mascot from the reference image: ${MASCOT_DESC}`,
  },
  default: {
    first: `THE MAN: ${MAN_DESC}`,
    same: `THE MAN: the same man from the start frame, ${MAN_DESC}`,
    switch: `THE MAN: the cartoon character in the start frame exits during the opening transition and does not come back. Then the main character is ${MAN_DESC}`,
  },
};

const NAMES = {
  own: { request: 'mascot', label: 'My character' },
  default: { request: 'man', label: 'Default man' },
};

const START_HOLD = 0.3;
const END_HOLD = 0.7;
const MIN_SCENE = 2.5;

function fmt(seconds) {
  return (Math.round(seconds * 10) / 10).toFixed(1);
}

function characterMode(videos, i) {
  if (i === 0) return 'first';
  return videos[i].char === videos[i - 1].char ? 'same' : 'switch';
}

function sceneWindow(len, chained) {
  return [chained ? START_HOLD : 0, len - END_HOLD];
}

// Flow renders only 8s or 10s clips. A 9s video is rendered at 10s and trimmed to its
// first 9s afterwards. Everything else - the request to Claude, the scene window, the
// settle 0.7s before the cut - is planned for a real 9s clip, so Claude never has to
// know. Only the Flow prompt is told the render is longer, and to freeze the extra.
function renderSeconds(len) {
  return len === 9 ? 10 : len;
}

// Without this the model spreads the action across the whole 10s render and the trim
// cuts off the ending. It also keeps the frame at the trim point and the true last
// frame identical, which is what the next clip starts from.
function holdBlock(len) {
  const [, end] = sceneWindow(len, false);
  const total = renderSeconds(len);
  return `TIMING: The video is ${total} seconds long, but all of the action is finished by ${fmt(end)}s. From ${fmt(end)}s to the very end at ${total} seconds the final frame stays frozen: the camera stops pushing in and does not drift, nothing moves, nothing new appears and no text changes. The last ${fmt(total - end)} seconds are one still image.`;
}

// ---------- The short request pasted into a new chat in the Claude Project ----------

function buildRequest(videos) {
  return videos.map((v, i) => {
    const mode = characterMode(videos, i);
    const [from, to] = sceneWindow(v.len, i > 0);
    let start = 'fresh start';
    if (mode === 'same') start = `continues from Video ${i}`;
    if (mode === 'switch') start = `continues from Video ${i}, character changes from ${NAMES[videos[i - 1].char].request} to ${NAMES[v.char].request}`;
    return [
      `Video ${i + 1} | ${v.len}s | ${NAMES[v.char].request} | ${start} | scenes ${fmt(from)}–${fmt(to)}s`,
      ...v.lines,
    ].join('\n');
  }).join('\n\n');
}

// ---------- Project instructions (set once in the Claude Project) ----------

const EXAMPLE_VIDEOS = [
  { len: 10, char: 'default', lines: ['A guy I used to work with got a raise.', 'Almost 40% more, in one single jump.', 'He called me that same night, so excited.'] },
  { len: 10, char: 'default', lines: ['He told me, finally my life is going to change.', 'Six months later, he asked me for a loan.', 'Same guy, bigger salary, still broke.'] },
];

const EXAMPLE_REPLY = `=== VIDEO 1 ===
0.0–3.5s: The man sits at a vintage office desk with a typewriter. A cutout hand slides a white envelope with no readable text across the desk to him, and he opens it. Small text "A GUY I WORKED WITH" appears, then the big headline "GOT A RAISE" scrambles in with a thin line drawing under it.

3.5–6.2s: A zoom-through into a graph-paper grid with red axes. A tall red bar shoots up with a bounce next to a short one, and the man leaps from the short bar onto the tall one along a navy blue curved arrow. The big headline "+40%" slams in, with small text "IN ONE JUMP" above it.

6.2–9.3s: A whip-pan to a darker night version of the grey wall with a single street lamp casting a cone of light. The man stands under the lamp holding a vintage telephone receiver to his ear, his free hand raised high. Small text "THAT SAME NIGHT" appears, then a tilted black sticker box "SO EXCITED" slaps in.

At 9.3s all motion settles and the camera comes to a complete stop. FINAL FRAME: the man standing under the street lamp with the phone to his ear, lit by the lamp's cone of light, with the small text "THAT SAME NIGHT" and the black sticker box "SO EXCITED" still on screen, completely still and sharp.
=== VIDEO 2 ===
0.3–3.6s: The text "THAT SAME NIGHT" and the sticker "SO EXCITED" scramble away as the camera pushes past the street lamp into a thick navy blue ribbon swooshing diagonally upward across the grey wall. The man rides up along the ribbon with both arms raised. Small text "FINALLY," appears, then the big headline "MY LIFE WILL CHANGE" scrambles in.

3.6–6.6s: A whip-pan to a giant black-and-white tear-off calendar with plain pages and no readable text, its pages ripping off and flying away one after another. The man slides in from the right with one empty palm held out. Small text "SIX MONTHS LATER" appears, then a tilted black sticker box "A LOAN?" slaps in.

6.6–9.3s: A zoom-out onto a graph-paper grid with red axes, where the man stands on top of a tall red bar and turns his empty trouser pockets inside out. Three tilted sticker boxes slap in one by one, stacked: black "SAME GUY", black "BIGGER SALARY", red "STILL BROKE".

At 9.3s all motion settles and the camera comes to a complete stop. FINAL FRAME: the man standing on top of the tall red bar on the graph-paper grid with his pockets turned out, with the sticker boxes "SAME GUY", "BIGGER SALARY" and "STILL BROKE" still on screen, completely still and sharp.
=== END ===`;

const PROJECT_INSTRUCTIONS = `You write the scene part of video prompts for the motion-graphics clips on my YouTube channel. I generate each clip in Google Flow with the "Omni 1.1 Flash" video model and record the voiceover separately. My web app wraps your text with the fixed parts (format, style, character description, audio), so you write ONLY the timed scenes and the ending line of each clip. Don't ask questions and don't explain; just reply in the output format.

== WHAT I SEND YOU ==
One block per clip:
Video N | length | character | start | scene window
then the voiceover lines (one line = one scene).

- character: "mascot" is my flat 2D cartoon mascot (round white head, black fedora, tan scarf); call it "the character". "man" is a 1950s office worker in a dark suit and fedora, a black-and-white photo cutout; call him "the man".
- start: "fresh start" for Video 1. "continues from Video N" means the clip starts on that clip's final frame. It may add "character changes from X to Y".
- scene window: where your scenes start and end, e.g. "scenes 0.3–9.3s".

== THE LOOK (my target reference video) ==
Vertical 9:16 vintage editorial collage motion graphics. A light grey paper wall with a heavy vignette and film grain. Black-and-white 1950s photo cutouts (people in suits, noir figures in fedoras and trench coats, hands, money, office props) with drop shadows and parallax depth. The only accent colors are bold red and navy blue, plus full-color brand logos when a brand is named. Two-tier text: a small thin uppercase kicker above a big heavy condensed headline, or tilted black sticker boxes; letters scramble in. Thin hand-drawn lines, brackets and arrows draw themselves on. A constant slow push-in, with whip-pans and zoom-throughs between scenes. The scene changes every 2.5–3.5 seconds, each time to a different set.

== SETS (from the reference video) ==
- the grey paper wall with a soft spotlight (neutral)
- a graph-paper grid with light blue lines and red axes with tick marks; objects travel along curvy black arrows
- a bar chart: red bars or podium blocks rising, a gold #1 ribbon
- red 3D curved ledges stacked up the frame, with tiny figures standing on them and piles of cash
- dark rippling water across the bottom third of the frame
- a dramatic dark stage: light beams from above, figures in silhouette
- noir night: a single street lamp casting a cone of light and a long shadow
- a thick navy blue ribbon swooshing diagonally across the frame
- big cutout props in front of the wall: a giant alarm clock, a hand holding cash, a vintage desk, a tear-off calendar, a ladder, a zig-zag staircase

== SCENE RULES ==
1. One scene per voiceover line, starting with its time range, e.g. "0.3–3.3s:". Fill the scene window exactly. Share the time by how long each line takes to say (roughly by word count), with no scene shorter than 2.5s.
2. A scene has at most 3 actions in total: (a) the move into its set, (b) ONE big, simple physical motion by the character or a prop, (c) the text reveal. Big motions read well: slide, drop, jump, shoot up, spin, sink, unroll, rip off, draw on. Never write subtle acting (facial expressions, finger pokes, folding arms, small gestures); the model can't show it.
3. Every scene in a clip uses a different set from the list. Move into it with a whip-pan, a zoom-through, or elements sliding in from off-frame, and vary these.
4. Choose a concrete visual metaphor a viewer gets instantly (a hamster wheel for "just work harder", paychecks as stepping stones sinking into dark water for "paycheck to paycheck").
5. The clip's character appears in most scenes. Other people and all props are black-and-white 1950s photo cutouts. Colors: grey, bold red and navy blue only.
6. Paper props (paychecks, bank statements, receipts, calendars, documents) always have "no readable text" or "illegible grey lines".
7. In a clip that continues from the previous one, the first scene opens by clearing the start frame: name the previous clip's final on-screen text and make it scramble away while the camera whip-pans or zooms through into the new set. If the character changes, the old character exits in that same move and the new one is waiting in the new set.

== ON-SCREEN TEXT ==
- Each scene uses one of these:
  - Small text "..." appears, then the big headline "..." scrambles in. (kicker of 2–5 words, headline of 1–3 words)
  - Small text "..." appears, then a tilted black sticker box "..." slaps in.
  - For a list of 2–3 short words: tilted sticker boxes that slap in one by one, stacked.
- Use keywords or a short paraphrase of the line, never the full sentence. Uppercase, in "double quotes". Write numbers as numerals: "$100K+", "+40%", "412".
- Use a red sticker box at most once per clip, for its most important word.

== ENDING LINE (every clip) ==
At {end of the scene window}s all motion settles and the camera comes to a complete stop. FINAL FRAME: {the last scene's subject and props}, with {its on-screen text} still on screen, completely still and sharp.
Never clear the text at the end: the next clip starts from this frame.

== OUTPUT FORMAT ==
Exactly this, with no intro, no notes and no code fences:
=== VIDEO 1 ===
{scene}

{scene}

{ending line}
=== VIDEO 2 ===
...
=== END ===

== EXAMPLE ==
I send:
${buildRequest(EXAMPLE_VIDEOS)}

You reply:
${EXAMPLE_REPLY}
`;

// ---------- Claude's reply -> ready Flow prompts ----------

function parseReply(text) {
  const clean = text.replace(/\r\n?/g, '\n').replace(/^\s*```.*$/gm, '');
  const endAt = clean.search(/^[\s*#]*=+\s*END\s*=+[\s*]*$/im);
  const body = endAt >= 0 ? clean.slice(0, endAt) : clean;
  const marks = [...body.matchAll(/^[\s*#]*=+\s*VIDEO\s*(\d+)\s*=+[\s*]*$/gim)];
  const scenes = {};
  marks.forEach((m, i) => {
    const from = m.index + m[0].length;
    const to = i + 1 < marks.length ? marks[i + 1].index : body.length;
    const part = body.slice(from, to).trim().replace(/\n{3,}/g, '\n\n');
    if (part) scenes[Number(m[1])] = part;
  });
  return scenes;
}

function buildFlowPrompt(video, mode, scenes) {
  const trimmed = renderSeconds(video.len) !== video.len;
  const parts = [`Vertical 9:16 motion-graphics video, ${renderSeconds(video.len)} seconds.`];
  if (mode !== 'first') parts.push(OPENING);
  parts.push(STYLE, CHARACTER_BLOCKS[video.char][mode], scenes);
  if (trimmed) parts.push(holdBlock(video.len));
  parts.push(AUDIO);
  return parts.join('\n\n');
}

// prev = the video before this one, whose last frame this one starts on.
function attachLine(video, mode, index, prev) {
  const own = video.char === 'own';
  if (mode === 'first') return own ? 'your character image as the reference image' : 'nothing, text only';
  const cut = prev && renderSeconds(prev.len) !== prev.len ? ` (after trimming it to ${prev.len}s)` : '';
  const start = `the last frame of Video ${index}${cut} as the start frame`;
  if (!own) return start;
  return mode === 'switch'
    ? `${start}, plus your character image (important: the mascot is not in the start frame)`
    : `${start}, plus your character image if Flow allows a second image`;
}

// ---------- UI ----------

const STORAGE_KEY = 'mgPromptGen.v1';
const DEFAULT_LENGTH = 10;
const DEFAULT_CHAR = 'own';
const LENGTHS = [10, 9, 8];

const els = {
  tab: $('tab-mg'),
  videos: $('mgVideos'),
  videoTpl: $('mgVideoTpl'),
  promptTpl: $('mgPromptTpl'),
  request: $('mgRequest'),
  copyRequest: $('mgCopyRequest'),
  requestStatus: $('mgRequestStatus'),
  reply: $('mgReply'),
  replyStatus: $('mgReplyStatus'),
  prompts: $('mgPrompts'),
  setupStatus: $('mgSetupStatus'),
};

let uid = 0;

function readLines(text) {
  return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function cards() {
  return [...els.videos.querySelectorAll('.mg-video')];
}

function addVideo(text = '', len = DEFAULT_LENGTH, char = DEFAULT_CHAR) {
  const node = els.videoTpl.content.firstElementChild.cloneNode(true);
  const id = uid++;
  node.querySelectorAll('.mg-len input').forEach((r) => {
    r.name = `mg-len-${id}`;
    r.checked = Number(r.value) === len;
  });
  node.querySelectorAll('.mg-char input').forEach((r) => {
    r.name = `mg-char-${id}`;
    r.checked = r.value === char;
  });
  node.querySelector('.mg-script').value = text;
  els.videos.appendChild(node);
  return node;
}

function getVideos() {
  return cards().map((c) => ({
    text: c.querySelector('.mg-script').value,
    len: Number(c.querySelector('.mg-len input:checked').value),
    char: c.querySelector('.mg-char input:checked').value,
  }));
}

function cardNote(videos, i) {
  const count = readLines(videos[i].text).length;
  if (count === 0) return { text: 'Empty, skipped', warn: true };
  const [from, to] = sceneWindow(videos[i].len, i > 0);
  const perScene = (to - from) / count;
  let text = `${count} ${count === 1 ? 'line' : 'lines'}`;
  let warn = false;
  if (perScene < MIN_SCENE) {
    warn = true;
    text = videos[i].len < 10
      ? `${count} lines in ${videos[i].len}s is only ${fmt(perScene)}s per scene, 10s works better`
      : `${count} lines is only ${fmt(perScene)}s per scene, consider splitting it`;
  }
  if (i > 0 && videos[i].char !== videos[i - 1].char) text += ' · character changes here';
  return { text, warn };
}

function renderPrompts(filled, scenes) {
  els.prompts.replaceChildren();
  filled.forEach((v, i) => {
    const mode = characterMode(filled, i);
    const node = els.promptTpl.content.firstElementChild.cloneNode(true);
    node.querySelector('.mg-prompt-title').textContent = `Video ${i + 1} — ${v.len}s · ${NAMES[v.char].label}`;
    node.querySelector('.mg-attach').textContent = `Attach in Flow: ${attachLine(v, mode, i, filled[i - 1])}`;
    const trim = node.querySelector('.mg-trim');
    if (renderSeconds(v.len) !== v.len) {
      const [, end] = sceneWindow(v.len, false);
      trim.textContent = `In Flow pick ${renderSeconds(v.len)}s, then trim the download to its first ${v.len}.0s.`
        + ` The action ends at ${fmt(end)}s; everything after is the frozen final frame.`;
      trim.hidden = false;
    }
    const box = node.querySelector('.mg-prompt-text');
    const button = node.querySelector('.mg-copy-prompt');
    if (scenes[i + 1]) {
      box.value = buildFlowPrompt(v, mode, scenes[i + 1]);
    } else {
      box.value = '';
      box.placeholder = "Waiting for this video's scenes in Claude's reply.";
      button.disabled = true;
    }
    els.prompts.appendChild(node);
  });
}

function update() {
  const videos = getVideos();
  const all = cards();

  all.forEach((card, i) => {
    card.querySelector('.mg-video-title').textContent = `Video ${i + 1}`;
    card.querySelector('.mg-remove').hidden = all.length === 1;
    const note = cardNote(videos, i);
    const meta = card.querySelector('.mg-meta');
    meta.textContent = note.text;
    meta.classList.toggle('warn', note.warn);
  });

  const filled = videos
    .map((v) => ({ lines: readLines(v.text), len: v.len, char: v.char }))
    .filter((v) => v.lines.length);

  els.request.value = filled.length ? buildRequest(filled) : '';
  els.copyRequest.disabled = !filled.length;
  els.requestStatus.textContent = '';

  const scenes = parseReply(els.reply.value);
  const found = filled.filter((_, i) => scenes[i + 1]).length;
  if (!els.reply.value.trim()) {
    els.replyStatus.textContent = "Paste Claude's reply to build the Flow prompts.";
    els.replyStatus.classList.remove('warn');
  } else {
    els.replyStatus.textContent = `Found scenes for ${found} of ${filled.length} ${filled.length === 1 ? 'video' : 'videos'}.`;
    els.replyStatus.classList.toggle('warn', found !== filled.length);
  }
  renderPrompts(filled, scenes);

  saveState({ videos, reply: els.reply.value });
}

// Browser-only draft of what is typed here - a convenience, never the only copy of anything.
function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) { /* storage unavailable, nothing to keep */ }
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (e) {
    return null;
  }
}

function resetVideos() {
  els.videos.replaceChildren();
  addVideo();
  addVideo();
}

function copyRequest() {
  if (!els.request.value) return;
  copyText(els.request.value);
  els.requestStatus.textContent = 'Copied. Paste it into a new chat in your Claude Project.';
}

// A pasted script with blank lines between parts fills this video and the ones after it.
els.videos.addEventListener('paste', (e) => {
  const box = e.target.closest('.mg-script');
  if (!box) return;
  const text = e.clipboardData.getData('text').replace(/\r\n?/g, '\n');
  const parts = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return;
  e.preventDefault();
  let card = box.closest('.mg-video');
  parts.forEach((part, i) => {
    if (i > 0) card = card.nextElementSibling || addVideo();
    card.querySelector('.mg-script').value = part;
  });
  update();
});

els.videos.addEventListener('input', update);
els.videos.addEventListener('change', update);
els.videos.addEventListener('click', (e) => {
  if (!e.target.closest('.mg-remove')) return;
  e.target.closest('.mg-video').remove();
  update();
});

els.reply.addEventListener('input', update);

els.prompts.addEventListener('click', (e) => {
  const button = e.target.closest('.mg-copy-prompt');
  if (!button) return;
  copyText(button.closest('.mg-prompt').querySelector('.mg-prompt-text').value);
  button.textContent = '✓ Copied';
  setTimeout(() => { button.textContent = '📋 Copy'; }, 1500);
});

$('mgAddVideo').addEventListener('click', () => {
  addVideo().querySelector('.mg-script').focus();
  update();
});

$('mgClearAll').addEventListener('click', () => {
  resetVideos();
  els.reply.value = '';
  update();
});

els.copyRequest.addEventListener('click', copyRequest);

$('mgCopyInstructions').addEventListener('click', () => {
  copyText(PROJECT_INSTRUCTIONS);
  els.setupStatus.textContent = 'Copied. Paste it into your Claude Project\'s instructions.';
});

// Only while this tab is showing - the other tabs have their own text boxes.
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter' && els.tab.classList.contains('active')) {
    e.preventDefault();
    copyRequest();
  }
});

// ---------- Start ----------

const saved = loadState();
if (saved && Array.isArray(saved.videos) && saved.videos.length) {
  // Older saves kept one character for all videos in saved.char.
  const fallbackChar = saved.char === 'default' ? 'default' : DEFAULT_CHAR;
  saved.videos.forEach((v) => addVideo(
    v.text || '',
    LENGTHS.includes(v.len) ? v.len : DEFAULT_LENGTH,
    v.char === 'own' || v.char === 'default' ? v.char : fallbackChar,
  ));
} else {
  resetVideos();
}
if (saved && typeof saved.reply === 'string') els.reply.value = saved.reply;
update();

})();
