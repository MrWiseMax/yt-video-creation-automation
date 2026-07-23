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

/* Boot all three tabs once the page (and script.js) is ready. */
window.addEventListener("load", async () => {
  try { await studioLoadSettings(); } catch (e) { console.error(e); }
  radarInit();
  packagingInit();
  autopsyInit();
});
