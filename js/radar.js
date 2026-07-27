"use strict";
/* ================= Outlier Radar tab ================= */

function radarInit() {
  $("studioSettingsBtn").addEventListener("click", () => {
    const card = $("studioSettingsCard");
    const open = card.style.display !== "none";
    card.style.display = open ? "none" : "block";
    if (!open) fillSettingsForm();
  });
  $("stSaveBtn").addEventListener("click", saveStudioSettings);
  $("stTestBtn").addEventListener("click", testStudioConnection);
  $("stSetChannelBtn").addEventListener("click", setMyChannel);
  $("chanAddBtn").addEventListener("click", addChannel);
  $("chanInput").addEventListener("keydown", e => { if (e.key === "Enter") addChannel(); });
  $("sfuFetchBtn").addEventListener("click", loadVideoForScript);
  $("sfuUrl").addEventListener("keydown", e => { if (e.key === "Enter") loadVideoForScript(); });
  $("radarRefreshBtn").addEventListener("click", refreshRadarData);
  ["radarSort", "radarMin", "radarHideShorts", "radarSearch"].forEach(id =>
    $(id).addEventListener(id === "radarSort" || id === "radarHideShorts" ? "change" : "input", renderRadarFeed));
  radarLoad();
}

async function radarLoad() {
  try {
    const [chans, vids] = await Promise.all([
      sb("/outlier_radar_channels?select=*&order=added_at.desc"),
      sb("/outlier_radar_videos?select=video_id,channel_id,title,thumbnail_url,published_at,duration_seconds,view_count,views_per_day,outlier_score,is_short,claude_analysis,analyzed_at&order=published_at.desc&limit=500"),
    ]);
    studio.channels = chans || [];
    studio.radarVideos = vids || [];
  } catch (e) {
    console.error(e);
    $("radarFeed").innerHTML = "<div class='emptybig'>⚠ Could not load radar data — check internet and reload.</div>";
    return;
  }
  renderChannelChips();
  renderRadarFeed();
}

/* ---------- settings ---------- */

/* The channel input used to be blanked on every open, so the handle looked lost
   after a reload even though the channel itself was saved. studio_settings only
   stores the resolved id/title, so remember what was actually typed here in this
   browser and fall back to the canonical /channel/UC… link (which resolves just
   as well) on a browser that has never set it. */
const MY_CHANNEL_LS = "studio_my_channel";

function savedMyChannel() {
  const typed = localStorage.getItem(MY_CHANNEL_LS);
  if (typed) return typed;
  const id = (studio.settings || {}).my_channel_id;
  return id ? "https://www.youtube.com/channel/" + id : "";
}

function fillSettingsForm() {
  const s = studio.settings || {};
  $("stAppKey").value = studioAppKey();
  $("stMyChannel").value = savedMyChannel();
  $("stMyChannelStatus").textContent = s.my_channel_title
    ? "Current channel: " + s.my_channel_title : "No channel set yet.";
  $("stNiche").value = s.niche_description || "";
  $("stPersona").value = s.persona_notes || "";
  $("stMinScore").value = s.min_outlier_score != null ? s.min_outlier_score : "3";
}

async function saveStudioSettings() {
  const keyVal = $("stAppKey").value.trim();
  if (keyVal) localStorage.setItem("studio_app_key", keyVal);
  const patch = {
    niche_description: $("stNiche").value.trim(),
    persona_notes: $("stPersona").value.trim(),
    min_outlier_score: Number($("stMinScore").value) || 3,
    updated_at: new Date().toISOString(),
  };
  try {
    await sb("/studio_settings?id=eq.1", { method: "PATCH", body: JSON.stringify(patch) });
    Object.assign(studio.settings, patch);
    toast("Settings saved ✓");
  } catch (e) {
    console.error(e);
    toast("Could not save settings — check internet", true);
  }
}

async function testStudioConnection() {
  const el = $("stTestStatus");
  const keyVal = $("stAppKey").value.trim();
  if (keyVal) localStorage.setItem("studio_app_key", keyVal);
  el.className = "settingsstatus"; el.textContent = "Testing…";
  try {
    const r = await studioApi("ping", {}, 20000);
    el.className = "settingsstatus ok";
    el.textContent = "✓ App key OK · YouTube key: " + (r.yt_key ? "✓" : "✗ missing (run set-keys.ps1)") +
      " · Claude key: " + (r.claude_key ? "✓" : "✗ missing (run set-keys.ps1)") +
      " · Analytics OAuth: " + (r.analytics_oauth ? "✓" : "— optional");
  } catch (e) {
    el.className = "settingsstatus err";
    el.textContent = "✗ " + e.message;
  }
}

async function setMyChannel() {
  const q = $("stMyChannel").value.trim();
  if (!q) { toast("Paste your channel link first", true); return; }
  const btn = $("stSetChannelBtn"); btn.disabled = true; btn.textContent = "Setting…";
  try {
    const r = await studioApi("set_my_channel", { query: q });
    localStorage.setItem(MY_CHANNEL_LS, q);   // only once it actually resolved
    $("stMyChannelStatus").textContent = "Current channel: " + r.channel.title +
      " — " + r.videos_imported + " videos imported";
    await studioLoadSettings();
    toast("Channel set ✓ — Autopsy tab is now live");
    autopsyLoad();
  } catch (e) {
    toast("Failed: " + e.message, true);
  }
  btn.disabled = false; btn.textContent = "Set";
}

/* ---------- channels ---------- */
function renderChannelChips() {
  const box = $("chanList");
  if (!studio.channels.length) {
    box.innerHTML = "<div class='emptylist'>No channels tracked yet — paste a competitor's channel link above.</div>";
    return;
  }
  box.innerHTML = studio.channels.map(c =>
    "<span class='chip' data-id='" + esc(c.channel_id) + "'>" +
      (c.thumbnail_url ? "<img src='" + esc(c.thumbnail_url) + "' alt=''>" : "") +
      esc(c.title) +
      "<small>~" + fmtNum(c.median_views) + " typ.</small>" +
      "<button title='Stop tracking'>×</button></span>").join("");
  box.querySelectorAll(".chip button").forEach(b =>
    b.addEventListener("click", async () => {
      const chip = b.closest(".chip"), id = chip.dataset.id;
      const ch = studio.channels.find(c => c.channel_id === id);
      if (!confirm("Stop tracking \"" + (ch ? ch.title : id) + "\" and delete its videos from the radar?")) return;
      try {
        await sb("/outlier_radar_channels?channel_id=eq." + encodeURIComponent(id), { method: "DELETE" });
        toast("Removed");
        radarLoad();
      } catch (e) { toast("Delete failed — check internet", true); }
    }));
}

async function addChannel() {
  const q = $("chanInput").value.trim();
  if (!q) return;
  const btn = $("chanAddBtn"); btn.disabled = true; btn.textContent = "Adding…";
  try {
    const r = await studioApi("resolve_channel", { query: q });
    toast("Tracking \"" + r.channel.title + "\" — " + r.videos_collected + " videos collected ✓");
    $("chanInput").value = "";
    radarLoad();
  } catch (e) {
    toast("Failed: " + e.message, true);
  }
  btn.disabled = false; btn.textContent = "+ Track";
}

async function refreshRadarData() {
  const btn = $("radarRefreshBtn"); btn.disabled = true;
  try {
    await studioApi("refresh_radar", {}, 20000);
    toast("Refreshing in the background — reload the page in ~1 minute");
  } catch (e) { toast("Failed: " + e.message, true); }
  btn.disabled = false;
}

/* ---------- feed ---------- */
function scoreBadge(s) {
  if (s == null) return "<span class='rscore'>—</span>";
  const cls = s >= 5 ? " hot" : s >= 2.5 ? " warm" : "";
  return "<span class='rscore" + cls + "'>" + Number(s).toFixed(1) + "×</span>";
}

function renderRadarFeed() {
  const box = $("radarFeed");
  if (!studio.channels.length) {
    box.innerHTML = "<div class='emptybig'>📡 Add 5–10 competitor channels above to start the radar.<br>" +
      "<small>Data refreshes automatically every night; scores appear as soon as a channel is collected.</small></div>";
    return;
  }
  const chanById = Object.fromEntries(studio.channels.map(c => [c.channel_id, c]));
  const sort = $("radarSort").value;
  const min = parseFloat($("radarMin").value) || 0;
  const hideShorts = $("radarHideShorts").checked;
  const q = $("radarSearch").value.trim().toLowerCase();

  let vids = studio.radarVideos.filter(v =>
    (!hideShorts || !v.is_short) &&
    (min <= 0 || (v.outlier_score != null && v.outlier_score >= min)) &&
    (!q || v.title.toLowerCase().includes(q)));
  vids.sort((a, b) => sort === "new"
    ? new Date(b.published_at) - new Date(a.published_at)
    : sort === "vpd" ? (b.views_per_day || 0) - (a.views_per_day || 0)
    : (b.outlier_score || 0) - (a.outlier_score || 0));
  vids = vids.slice(0, 80);

  if (!vids.length) {
    box.innerHTML = "<div class='emptybig'>Nothing matches the filters yet. New channels are collected within a minute of adding; " +
      "hit ↻ Refresh data or clear the filters.</div>";
    return;
  }
  box.innerHTML = vids.map(v => {
    const ch = chanById[v.channel_id];
    return "<div class='ritem' data-vid='" + esc(v.video_id) + "'>" +
      "<a href='https://www.youtube.com/watch?v=" + esc(v.video_id) + "' target='_blank' rel='noopener'>" +
        "<img class='rthumb' loading='lazy' src='" + esc(v.thumbnail_url || "") + "' alt=''></a>" +
      "<div class='rmain'>" +
        "<a class='rtitle' href='https://www.youtube.com/watch?v=" + esc(v.video_id) + "' target='_blank' rel='noopener'>" + esc(v.title) + "</a>" +
        "<div class='rsub'>" + esc(ch ? ch.title : "?") + " · " + relTime(v.published_at) + " · " +
          fmtNum(v.view_count) + " views · " + fmtNum(v.views_per_day) + "/day" +
          (v.is_short ? " · Short" : "") + "</div>" +
        "<div class='analysisbox' style='display:none'></div>" +
        "<div class='scriptbox' style='display:none'></div>" +
      "</div>" +
      "<div class='rside'>" + scoreBadge(v.outlier_score) +
        "<button class='sbtn analyzebtn'>" + (v.claude_analysis ? "View analysis" : "🧠 Analyze") + "</button>" +
        "<button class='sbtn scriptbtn'>📝 Script</button>" +
      "</div></div>";
  }).join("");

  box.querySelectorAll(".ritem").forEach(item => {
    const vid = item.dataset.vid;
    item.querySelector(".analyzebtn").addEventListener("click", () => toggleRadarAnalysis(item, vid));
    item.querySelector(".scriptbtn").addEventListener("click", () => toggleScriptBox(item, vid));
  });
}

function renderRadarAnalysis(el, a) {
  el.innerHTML =
    "<h4>Why it worked</h4><div>" + esc(a.why_it_worked) + "</div>" +
    "<h4>Your angles</h4>" +
    (a.my_angles || []).map(x =>
      "<div class='anglecard'><b>" + esc(x.video_title) + "</b>" + esc(x.angle) +
      "<br><button class='sbtn' data-copytitle='" + esc(x.video_title) + "'>📋 Copy title</button></div>").join("") +
    "<h4>Packaging notes</h4><div>" + esc(a.packaging_notes || "") + "</div>";
  el.querySelectorAll("[data-copytitle]").forEach(b =>
    b.addEventListener("click", () => copyText(b.dataset.copytitle)));
}

async function toggleRadarAnalysis(item, videoId) {
  const boxEl = item.querySelector(".analysisbox");
  const btn = item.querySelector(".analyzebtn");
  const v = studio.radarVideos.find(x => x.video_id === videoId);
  if (boxEl.style.display !== "none") { boxEl.style.display = "none"; return; }
  if (v && v.claude_analysis) {
    renderRadarAnalysis(boxEl, v.claude_analysis);
    boxEl.style.display = "block";
    return;
  }
  btn.disabled = true; btn.textContent = "Analyzing… ~1 min";
  try {
    const r = await studioApi("analyze_video", { video_id: videoId });
    if (v) { v.claude_analysis = r.analysis; v.analyzed_at = new Date().toISOString(); }
    renderRadarAnalysis(boxEl, r.analysis);
    boxEl.style.display = "block";
    btn.textContent = "View analysis";
  } catch (e) {
    toast("Analysis failed: " + e.message, true);
    btn.textContent = "🧠 Analyze";
  }
  btn.disabled = false;
}

/* ---------- script-from-video workflow (no Claude API cost — builds a paste-ready prompt) ----------
   ONE form, two entry points: the 📝 Script button on a radar item and the
   🔗 "Script from any video URL" card. Both render scriptFormHtml() and both
   emit through buildScriptFromVideoPrompt(), so the prompt is byte-for-byte the
   same whichever way you got here. */

const TRANSCRIPT_STEPS =
  "<div class='note'><b>Grab the transcript (about 10 seconds):</b><br>" +
  "1. Open the video → under it click <b>…more</b><br>" +
  "2. Scroll down → <b>Show transcript</b><br>" +
  "3. In the transcript panel click <b>⋮</b> → <b>Toggle timestamps</b> (off)<br>" +
  "4. Click inside the panel, select all and copy → paste below</div>";

function scriptFormHtml(o) {
  const haveSamples = typeof settings !== "undefined" &&
    settings.samples && settings.samples.some(s => s && s.trim());
  return (o.heading ? "<h4>" + esc(o.heading) + "</h4>" : "") +
    (haveSamples ? "" :
      "<div class='note warn'>No sample scripts saved yet — add them in <b>🎬 Create → Setup</b> so the script keeps your voice.</div>") +
    (o.steps ? TRANSCRIPT_STEPS : "") +
    "<label>Topic / idea <span class='lbl-note'>(" +
      esc(o.topicNote || "edit freely") + ")</span></label>" +
    "<input type='text' class='sf-topic' value=\"" + esc(o.title || "") + "\">" +
    "<label>Reference transcript <span class='lbl-note'>(inspiration only — never copied; " +
      "leave empty to use the topic alone)</span> <span class='sf-count lbl-note'></span></label>" +
    "<textarea class='sf-tr mono' rows='" + (o.rows || 4) + "' placeholder='" +
      esc(o.trPlaceholder || "On YouTube: open the video → “…more” → Show transcript → copy it here") +
      "'>" + esc(o.transcript || "") + "</textarea>" +
    (o.url ? "<a class='sf-link lbl-note' href='" + esc(o.url) + "' target='_blank' rel='noopener'>" +
      "▶ Open the video to grab its transcript</a>" : "") +
    "<label>Extra angle / key points <span class='lbl-note'>(optional)</span></label>" +
    "<textarea class='sf-notes' rows='2' placeholder='e.g. focus on beginners, add a real example, avoid jargon…'>" +
      esc(o.notes || "") + "</textarea>" +
    (o.chapters && o.chapters.length
      ? "<button class='btn secondary sf-chapters' style='margin-top:8px'>⤵ Use the video's " +
        o.chapters.length + " chapters as key points</button>" : "") +
    "<button class='btn sf-gen'>⚙ Build the script prompt</button>" +
    "<div class='sf-outwrap' style='display:none'>" +
      "<label>Ready-to-paste prompt</label>" +
      "<textarea class='sf-out promptout' rows='12' readonly></textarea>" +
      "<button class='btn sf-copy'>📋 Copy full prompt</button>" +
      "<div class='note'>Paste into <b>Claude / ChatGPT</b>. It builds <span class='filename'>voice-over-script.txt</span> — " +
        "save it into the video's folder, then continue at <b>🎬 Create → Step 2</b>.</div>" +
    "</div>";
}

function wireScriptForm(boxEl, ctx) {
  const tr = boxEl.querySelector(".sf-tr");
  const count = boxEl.querySelector(".sf-count");
  const updateCount = () => {
    const n = tr.value.trim() ? tr.value.trim().split(/\s+/).length : 0;
    count.textContent = n ? "— " + fmtNum(n) + " words pasted (~" +
      (n / 160).toFixed(1) + " min of speech)" : "";
  };
  tr.addEventListener("input", updateCount);
  updateCount();

  const chapBtn = boxEl.querySelector(".sf-chapters");
  if (chapBtn) chapBtn.addEventListener("click", () => {
    const notes = boxEl.querySelector(".sf-notes");
    const block = "Points the reference video covers (cover the same ground better, in my own words):\n" +
      (ctx.chapters || []).join("\n");
    notes.value = notes.value.trim() ? notes.value.trim() + "\n" + block : block;
    chapBtn.disabled = true;
  });

  boxEl.querySelector(".sf-gen").addEventListener("click", () => {
    boxEl.querySelector(".sf-out").value = buildScriptFromVideoPrompt({
      title: boxEl.querySelector(".sf-topic").value,
      transcript: tr.value,
      notes: boxEl.querySelector(".sf-notes").value,
      channel: ctx.channel,
      url: ctx.url,
    });
    const wrap = boxEl.querySelector(".sf-outwrap");
    wrap.style.display = "block";
    wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  boxEl.querySelector(".sf-copy").addEventListener("click", () =>
    copyText(boxEl.querySelector(".sf-out").value));
}

function toggleScriptBox(item, videoId) {
  const boxEl = item.querySelector(".scriptbox");
  if (boxEl.style.display !== "none") { boxEl.style.display = "none"; return; }
  const v = studio.radarVideos.find(x => x.video_id === videoId) || {};
  const ch = studio.channels.find(c => c.channel_id === v.channel_id) || {};
  const url = "https://www.youtube.com/watch?v=" + videoId;
  boxEl.innerHTML = scriptFormHtml({
    heading: "📝 Turn this into a voice-over script",
    title: v.title || "",
    topicNote: "prefilled from this video — edit freely",
    url: url,
  });
  boxEl.style.display = "block";
  wireScriptForm(boxEl, { channel: ch.title, url: url });
}

/* ---------- 🔗 script from any video URL ---------- */

/* Chapter lines out of a description ("0:00 Intro", "1:24 - The real reason"). */
function parseChapters(desc) {
  const out = [];
  String(desc || "").split(/\r?\n/).forEach(ln => {
    const m = ln.match(/^\s*[\(\[]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\)\]]?\s*[-–—:.]?\s+(.{2,110}?)\s*$/);
    if (m) out.push(m[1] + " " + m[2]);
  });
  return out.length >= 3 ? out : [];   // 3+ or it's probably not a chapter list
}

async function loadVideoForScript() {
  const url = $("sfuUrl").value.trim();
  const st = $("sfuStatus"), body = $("sfuBody"), btn = $("sfuFetchBtn");
  if (!url) { toast("Paste a YouTube video link first", true); return; }
  btn.disabled = true; btn.textContent = "Loading…";
  st.className = "settingsstatus"; st.textContent = "Reading the video…";
  try {
    const r = await studioApi("video_info", { url }, 30000);
    const chapters = parseChapters(r.description);
    st.className = "settingsstatus ok";
    st.textContent = "✓ " + r.title + " — " + r.channel_title + " · " +
      fmtDur(r.duration_seconds) + " · " + fmtNum(r.view_count) + " views" +
      (chapters.length ? " · " + chapters.length + " chapters found" : "");
    body.innerHTML = scriptFormHtml({
      heading: "📝 " + r.title,
      title: r.title,
      topicNote: "prefilled from the video — edit freely",
      trPlaceholder: "Paste the transcript here — steps above (or leave empty and use the topic + chapters alone)",
      rows: 8,
      steps: true,
      url: r.url,
      chapters: chapters,
    });
    body.style.display = "block";
    wireScriptForm(body, { channel: r.channel_title, url: r.url, chapters: chapters });
    body.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (e) {
    st.className = "settingsstatus err";
    st.textContent = "✗ " + e.message;
    body.style.display = "none";
  }
  btn.disabled = false; btn.textContent = "🔎 Load video";
}

/* Reuses the shared voice-over blocks from script.js so the output file stays
   pipeline-compatible; adds a reference-video "inspiration only, do not copy" layer. */
function buildScriptFromVideoPrompt(opts) {
  const dur = ((typeof settings !== "undefined" && settings.duration) || "").trim() || "8-12";
  const topic = (opts.title || "").trim() || "(!! the reference video's topic — fill this in !!)";
  const notes = (opts.notes || "").trim();
  const tr = (opts.transcript || "").trim();

  const meta = [];
  if (opts.channel) meta.push("Channel: " + opts.channel);
  if (opts.url) meta.push("Video URL: " + opts.url);

  const refBlock = tr
    ? [
"--- REFERENCE VIDEO (INSPIRATION ONLY - DO NOT COPY) ---",
"",
"A competitor's video on this topic is performing well. Its transcript is included below strictly as raw inspiration, so you understand what the topic covers and what made it resonate with viewers.",
      ].concat(meta, [
"",
"TRANSCRIPT (reference only - do NOT reuse its wording, structure, hook or examples):",
tr,
      ])
    : [
"--- REFERENCE VIDEO (INSPIRATION ONLY) ---",
"",
"A competitor's video on this topic is performing well, but no transcript was provided. Treat the TOPIC above as the only inspiration - do NOT imitate any specific video.",
      ].concat(meta);

  const freshRules = [
"--- HOW TO USE THE REFERENCE (critical) ---",
"- The reference only proves this TOPIC works. Do NOT reuse its wording, sentence structure, hook, order of points, jokes, analogies or examples.",
"- Cover the topic from fresh angles the reference did not take. Add new insights, deeper explanations and your own original, concrete examples.",
"- Aim to clearly BEAT the reference: a unique, higher-value script that is more useful and less repetitive - never a paraphrase or a reworded copy.",
"- If a line starts echoing the reference, stop and rewrite it as something original in my voice.",
  ];

  const notesBlock = notes
    ? ["", "ANGLE / KEY POINTS TO EMPHASIZE (my guidance):", notes]
    : [];

  const lengthBlock = [
"TARGET LENGTH: " + dur + " minutes.",
"My voice-over pace is about 155-165 spoken words per minute, so aim for roughly TARGET MINUTES x 160 words. For a range, land near the middle. Count your words before finishing; expand or trim the BODY sections (never the hook, never the ending) to land inside the target range.",
  ];

  return [
"You are a professional YouTube scriptwriter. Write a complete, ready-to-record voice-over script for my next video, matching my channel's exact tone and rhythm.",
"",
"--- MY SAMPLE SCRIPTS (study these for tone, rhythm and structure only - do NOT reuse their content or examples) ---",
"",
voSampleBlock(),
"",
"--- THE NEW VIDEO ---",
"",
"TOPIC / IDEA:",
topic,
  ]
    .concat(notesBlock)
    .concat([""], refBlock)
    .concat([""], freshRules)
    .concat([""], lengthBlock)
    .concat([""], voToneBlock(), [""], voFormatBlock(), [""], voOutputBlock())
    .join("\n");
}
