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
function fillSettingsForm() {
  const s = studio.settings || {};
  $("stAppKey").value = studioAppKey();
  $("stMyChannel").value = "";
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
      "</div>" +
      "<div class='rside'>" + scoreBadge(v.outlier_score) +
        "<button class='sbtn'>" + (v.claude_analysis ? "View analysis" : "🧠 Analyze") + "</button>" +
      "</div></div>";
  }).join("");

  box.querySelectorAll(".ritem").forEach(item => {
    const vid = item.dataset.vid;
    item.querySelector(".sbtn").addEventListener("click", () => toggleRadarAnalysis(item, vid));
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
  const btn = item.querySelector(".sbtn");
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
