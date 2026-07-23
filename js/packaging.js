"use strict";
/* ================= Packaging Lab tab ================= */

let pkgPreview = { title: null, thumb: null };

function packagingInit() {
  $("pkgGenBtn").addEventListener("click", pkgGenerate);
  $("pkgHistBtn").addEventListener("click", pkgHistoryLoad);
  pkgHistoryLoad();
}

function setPkgStatus(msg, cls) {
  const el = $("pkgStatus");
  el.textContent = msg;
  el.className = "settingsstatus " + (cls || "");
}

async function pkgGenerate() {
  const topic = $("pkgTopic").value.trim();
  if (!topic) { toast("Type the video topic first", true); return; }
  const btn = $("pkgGenBtn");
  btn.disabled = true;
  setPkgStatus("Generating with Claude… usually 30–90 seconds. Stay on this tab.");
  try {
    const r = await studioApi("generate_packaging", { topic, notes: $("pkgNotes").value.trim() });
    setPkgStatus("✓ Done", "ok");
    renderPkgResult(r.result, topic);
    pkgHistoryLoad();
  } catch (e) {
    setPkgStatus("✗ " + e.message, "err");
  }
  btn.disabled = false;
}

function renderPkgResult(result, topic) {
  const box = $("pkgResult");
  const titles = result.titles || [];
  const best = Math.max.apply(null, titles.map(t => t.score || 0));
  box.innerHTML =
    "<div class='card'><h3>Strategy — " + esc(topic) + "</h3><div class='note'>" + esc(result.strategy_note || "") + "</div>" +
      "<div id='pkgTitles'>" +
      titles.map(t => {
        const cls = t.score >= best ? " top" : t.score >= 7 ? " good" : "";
        return "<div class='trow'><span class='scorechip" + cls + "'>" + esc(t.score) + "</span>" +
          "<div class='tmain'><b>" + esc(t.title) + "</b><small>" + esc(t.rationale || "") + "</small></div>" +
          "<div class='tacts'><button class='sbtn' data-copy-t='" + esc(t.title) + "'>📋</button>" +
          "<button class='sbtn' data-prev-t='" + esc(t.title) + "'>👁 Preview</button></div></div>";
      }).join("") + "</div></div>" +
    "<div class='card'><h3>Thumbnail concepts</h3>" +
      (result.thumbnail_concepts || []).map(c =>
        "<div class='anglecard'><b>Text: " + esc(c.text_overlay) + "</b>" + esc(c.concept) + "</div>").join("") +
    "</div>" +
    "<div class='card' id='pkgPreviewCard' style='display:none'><h3>Feed preview — how it competes</h3>" +
      "<div class='inline'><input type='file' id='pkgThumbFile' accept='image/*'>" +
      "<span class='lbl-note'>optional: pick your draft thumbnail (stays on your computer)</span></div>" +
      "<div class='prevgrid' id='pkgPrevGrid'></div></div>";

  box.querySelectorAll("[data-copy-t]").forEach(b =>
    b.addEventListener("click", () => copyText(b.dataset.copyT)));
  box.querySelectorAll("[data-prev-t]").forEach(b =>
    b.addEventListener("click", () => { pkgPreview.title = b.dataset.prevT; renderPkgPreview(); }));
  const file = box.querySelector("#pkgThumbFile");
  if (file) file.addEventListener("change", () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { pkgPreview.thumb = rd.result; renderPkgPreview(); };
    rd.readAsDataURL(f);
  });
}

function renderPkgPreview() {
  const card = $("pkgPreviewCard");
  if (!card || !pkgPreview.title) return;
  card.style.display = "block";
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
    "<b>" + esc(pkgPreview.title) + "</b><span>" +
    esc((studio.settings && studio.settings.my_channel_title) || "Your channel") + " · just now</span></div>";
  const cards = comp.map(v =>
    "<div class='prevcard'><img class='pthumb' loading='lazy' src='" + esc(v.thumbnail_url) + "' alt=''>" +
    "<b>" + esc(v.title) + "</b><span>" + esc((chanById[v.channel_id] || {}).title || "") + " · " +
    fmtNum(v.view_count) + " views</span></div>");
  cards.splice(1, 0, mine); // your video in slot 2 of the fake feed
  $("pkgPrevGrid").innerHTML = cards.join("");
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function pkgHistoryLoad() {
  const box = $("pkgHistory");
  let rows;
  try {
    rows = await sb("/packaging_lab_sessions?select=id,topic,created_at&order=created_at.desc&limit=20");
  } catch (e) {
    box.innerHTML = "<div class='emptylist'>⚠ Could not load history.</div>";
    return;
  }
  if (!rows || !rows.length) {
    box.innerHTML = "<div class='emptylist'>No sessions yet — generate your first title set above.</div>";
    return;
  }
  box.innerHTML = rows.map(r =>
    "<div class='vrow' data-id='" + r.id + "'><div class='vmeta'><b>" + esc(r.topic) + "</b>" +
    "<span>" + new Date(r.created_at).toLocaleString() + "</span></div>" +
    "<button class='load'>Load</button><button class='del'>Delete</button></div>").join("");
  box.querySelectorAll(".vrow").forEach(row => {
    const id = row.dataset.id;
    row.querySelector(".load").addEventListener("click", async () => {
      try {
        const r = await sb("/packaging_lab_sessions?id=eq." + id + "&select=topic,result");
        if (r && r[0]) { renderPkgResult(r[0].result || {}, r[0].topic); window.scrollTo({ top: 0 }); }
      } catch (e) { toast("Load failed", true); }
    });
    row.querySelector(".del").addEventListener("click", async () => {
      if (!confirm("Delete this session?")) return;
      try { await sb("/packaging_lab_sessions?id=eq." + id, { method: "DELETE" }); pkgHistoryLoad(); }
      catch (e) { toast("Delete failed", true); }
    });
  });
}
