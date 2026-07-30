"use strict";
/* Shared plumbing for the Studio tabs (Radar / Packaging / Autopsy).
   Relies on globals from script.js: sb(), toast(), esc(), $ */

const STUDIO_FN_URL = "https://jgctukihjumyznviyavy.supabase.co/functions/v1";

const studio = {
  settings: null,   // studio_settings row
  channels: [],     // outlier_radar_channels
  radarVideos: [],  // outlier_radar_videos
  myVideos: [],     // video_autopsy_videos
  reports: [],      // video_autopsy_reports
};

function studioAppKey() { return localStorage.getItem("studio_app_key") || ""; }

/* Call the studio-api edge function. Long default timeout — AI actions can take a minute+. */
async function studioApi(action, payload = {}, timeoutMs = 240000) {
  const key = studioAppKey();
  if (!key) {
    toast("Paste the app key first — Radar tab → ⚙ Settings", true);
    throw new Error("app key not set");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(STUDIO_FN_URL + "/studio-api", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "x-app-key": key },
      body: JSON.stringify(Object.assign({ action }, payload)),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function fmtNum(n) {
  if (n == null) return "—";
  n = Number(n);
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "K";
  return String(Math.round(n));
}

function relTime(iso) {
  const d = (Date.now() - new Date(iso).getTime()) / 864e5;
  if (d < 1) return Math.max(1, Math.round(d * 24)) + "h ago";
  if (d < 30) return Math.round(d) + "d ago";
  if (d < 365) return Math.round(d / 30.4) + "mo ago";
  return (d / 365).toFixed(1) + "y ago";
}

function fmtDur(s) {
  if (!s) return "";
  const m = Math.floor(s / 60), sec = s % 60;
  return m + ":" + String(sec).padStart(2, "0");
}

async function studioLoadSettings() {
  const rows = await sb("/studio_settings?id=eq.1");
  studio.settings = (rows && rows[0]) || {};
}

/* ---------- shared prompt context blocks ----------
   The Studio tabs build their AI prompts here in the browser so I can run them in the
   same Claude chat that wrote the script — no API credits, and that chat still holds my
   sample scripts. These are the channel-context blocks every one of those prompts needs;
   they read the rows the tabs already pulled from Supabase, so they cost nothing. */

function studioChannelBlock() {
  const st = studio.settings || {};
  return [
"--- MY CHANNEL ---",
"Niche: " + (st.niche_description || "(not described yet — personal finance / self-improvement)"),
"Persona / style notes: " + (st.persona_notes || "(none provided)"),
  ].join("\n");
}

/** My own recent long-form titles with their views — the voice signal that matters for
    packaging, and a read on what my audience actually clicks. */
function studioMyTitlesBlock(limit) {
  const vids = (studio.myVideos || []).filter(v => !v.is_short).slice(0, limit || 25);
  if (!vids.length) return "(my channel's videos are not imported yet — set my channel in 📡 Radar → ⚙ Settings)";
  return vids.map(v =>
    "- \"" + v.title + "\" (" + Number(v.view_count || 0).toLocaleString() + " views)").join("\n");
}

/** Competitor videos beating their own channel baseline — pattern fuel, never to copy. */
function studioOutlierBlock(limit, days) {
  const since = Date.now() - (days || 90) * 864e5;
  const chanById = Object.fromEntries((studio.channels || []).map(c => [c.channel_id, c]));
  const rows = (studio.radarVideos || [])
    .filter(v => !v.is_short && v.outlier_score != null &&
      new Date(v.published_at).getTime() >= since)
    .sort((a, b) => b.outlier_score - a.outlier_score)
    .slice(0, limit || 15);
  if (!rows.length) return "(no competitor outliers collected yet — add channels in 📡 Radar)";
  return rows.map(v => "- \"" + v.title + "\" (" +
    Number(v.outlier_score).toFixed(1) + "x baseline, " +
    ((chanById[v.channel_id] || {}).title || "?") + ")").join("\n");
}

/* Boot all three tabs once the page (and script.js) is ready. */
window.addEventListener("load", async () => {
  try { await studioLoadSettings(); } catch (e) { console.error(e); }
  radarInit();
  packagingInit();
  autopsyInit();
});
