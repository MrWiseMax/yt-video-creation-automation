"use strict";
/* ================= Video Autopsy tab ================= */

function autopsyInit() {
  $("autopsyRefreshBtn").addEventListener("click", autopsyLoad);
  autopsyLoad();
}

async function autopsyLoad() {
  const intro = $("autopsyIntro"), list = $("autopsyList");
  if (!studio.settings || !studio.settings.my_channel_id) {
    intro.innerHTML = "<div class='emptybig'>🔬 Set <b>your own channel</b> first — Radar tab → ⚙ Settings → My channel.<br>" +
      "<small>Your uploads are then imported automatically and every new video gets a 48-hour and 14-day autopsy.</small></div>";
    list.innerHTML = "";
    return;
  }
  intro.innerHTML = "";
  try {
    const [vids, reports] = await Promise.all([
      sb("/video_autopsy_videos?select=*&order=published_at.desc&limit=50"),
      sb("/video_autopsy_reports?select=*&order=created_at.desc&limit=120"),
    ]);
    studio.myVideos = vids || [];
    studio.reports = reports || [];
  } catch (e) {
    console.error(e);
    list.innerHTML = "<div class='emptybig'>⚠ Could not load autopsy data — check internet and reload.</div>";
    return;
  }
  renderAutopsyList();
}

function renderAutopsyList() {
  const list = $("autopsyList");
  const vids = studio.myVideos.filter(v => !v.is_short);
  if (!vids.length) {
    list.innerHTML = "<div class='emptybig'>Your channel is set (" +
      esc(studio.settings.my_channel_title || "") +
      ") but no videos imported yet — hit ↻ Refresh list in a minute.</div>";
    return;
  }
  list.innerHTML = vids.map(v => {
    const reps = studio.reports.filter(r => r.video_id === v.video_id);
    const has = cp => reps.some(r => r.checkpoint === cp);
    const manual = reps.filter(r => r.checkpoint === "manual").length;
    return "<div class='arow' data-vid='" + esc(v.video_id) + "'>" +
      "<div class='arowhead'>" +
      "<a href='https://www.youtube.com/watch?v=" + esc(v.video_id) + "' target='_blank' rel='noopener'>" +
        "<img class='rthumb' loading='lazy' src='" + esc(v.thumbnail_url || "") + "' alt=''></a>" +
      "<div class='rmain'>" +
        "<a class='rtitle' href='https://www.youtube.com/watch?v=" + esc(v.video_id) + "' target='_blank' rel='noopener'>" + esc(v.title) + "</a>" +
        "<div class='rsub'>" + relTime(v.published_at) + " · " + fmtNum(v.view_count) + " views · " + fmtDur(v.duration_seconds) + "</div>" +
        "<div class='abadges'>" +
          "<span class='abadge" + (has("48h") ? " have" : "") + "'>48h " + (has("48h") ? "✓" : "…") + "</span>" +
          "<span class='abadge" + (has("14d") ? " have" : "") + "'>14d " + (has("14d") ? "✓" : "…") + "</span>" +
          (manual ? "<span class='abadge have'>" + manual + " manual</span>" : "") +
        "</div>" +
      "</div>" +
      "<div class='rside'><button class='sbtn openbtn'>" + (reps.length ? "Reports ▾" : "Run first autopsy ▾") + "</button></div>" +
      "</div><div class='adetail' style='display:none'></div></div>";
  }).join("");
  list.querySelectorAll(".arow").forEach(row => {
    row.querySelector(".openbtn").addEventListener("click", () => toggleAutopsyDetail(row));
  });
}

function metricBlock(m) {
  if (!m) return "";
  const a = m.analytics || {};
  const cells = [
    ["Views", fmtNum(m.view_count)],
    ["vs channel median", m.views_vs_channel_median != null ? m.views_vs_channel_median + "×" : "—"],
    ["Age", m.age_days + "d"],
    ["Like ratio", m.like_ratio_pct != null ? m.like_ratio_pct + "%" : "—"],
    ["Channel typical", m.channel_median_like_ratio_pct != null ? m.channel_median_like_ratio_pct + "%" : "—"],
  ];
  if (a.average_view_duration_s != null) cells.push(["Avg view duration", fmtDur(Math.round(a.average_view_duration_s))]);
  if (a.average_view_percentage != null) cells.push(["Avg % watched", a.average_view_percentage.toFixed(1) + "%"]);
  if (a.subscribers_gained != null) cells.push(["Subs gained", fmtNum(a.subscribers_gained)]);
  if (m.user_provided && m.user_provided.impressions) cells.push(["Impressions (pasted)", fmtNum(m.user_provided.impressions)]);
  if (m.user_provided && m.user_provided.ctr_percent) cells.push(["CTR (pasted)", m.user_provided.ctr_percent + "%"]);
  return "<div class='metricgrid'>" + cells.map(c => "<div class='metric'><b>" + c[1] + "</b>" + c[0] + "</div>").join("") + "</div>";
}

function reportBlock(r) {
  const rep = r.claude_report || {};
  return "<div class='reportbox'>" +
    "<div class='rephead'><span class='abadge have'>" + esc(r.checkpoint) + "</span>" +
      "<span class='lbl-note'>" + new Date(r.created_at).toLocaleString() + "</span></div>" +
    "<div class='repverdict'>" + esc(rep.verdict_headline || r.verdict || "") + "</div>" +
    metricBlock(r.metrics) +
    (rep.diagnosis || []).map(d =>
      "<div class='diagrow'><span class='dstat " + esc(d.status) + "'>" + esc(d.area) + "</span>" +
      "<div class='dbody'><b>" + esc(d.status) + "</b> — " + esc(d.evidence) +
      "<br><span class='fix'>→ " + esc(d.fix) + "</span></div></div>").join("") +
    (rep.summary ? "<h4 style='color:var(--accent); font-size:12px; text-transform:uppercase; letter-spacing:.8px; margin:12px 0 5px'>Story</h4><div style='font-size:13.5px'>" + esc(rep.summary) + "</div>" : "") +
    (rep.next_video_advice ? "<div class='note' style='margin:12px 0 0'>" + esc(rep.next_video_advice) + "</div>" : "") +
    "</div>";
}

function toggleAutopsyDetail(row) {
  const det = row.querySelector(".adetail");
  if (det.style.display !== "none") { det.style.display = "none"; return; }
  const vid = row.dataset.vid;
  const reps = studio.reports.filter(r => r.video_id === vid).slice(0, 3);
  det.innerHTML = reps.map(reportBlock).join("") +
    "<div class='runform'>" +
    "<div class='inline'><input type='text' class='ap-imp' placeholder='Impressions (optional)'>" +
    "<input type='text' class='ap-ctr' placeholder='CTR % (optional)'></div>" +
    "<div class='lbl-note' style='margin-top:6px'>Impressions &amp; CTR only exist in YouTube Studio — paste them for the full packaging verdict. " +
    "You can also paste the video's transcript below to locate where viewers drop.</div>" +
    "<textarea class='ap-tr mono' rows='3' placeholder='Transcript (optional)' style='margin-top:8px'></textarea>" +
    "<button class='btn ap-run'>🔬 Run autopsy now</button> <span class='settingsstatus ap-status'></span>" +
    "</div>";
  det.style.display = "block";
  const btn = det.querySelector(".ap-run"), status = det.querySelector(".ap-status");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    status.textContent = "Running… fetches fresh stats + Claude analysis, usually 30–90 s.";
    status.className = "settingsstatus";
    try {
      const payload = { video_id: vid };
      const imp = det.querySelector(".ap-imp").value.trim();
      const ctr = det.querySelector(".ap-ctr").value.trim();
      const tr = det.querySelector(".ap-tr").value.trim();
      if (imp) payload.impressions = imp;
      if (ctr) payload.ctr_percent = ctr;
      if (tr) payload.transcript = tr;
      const r = await studioApi("run_autopsy", payload);
      studio.reports.unshift(r.report);
      status.textContent = "✓ Done";
      status.className = "settingsstatus ok";
      det.insertAdjacentHTML("afterbegin", reportBlock(r.report));
      renderAutopsyList();
    } catch (e) {
      status.textContent = "✗ " + e.message;
      status.className = "settingsstatus err";
      btn.disabled = false;
    }
  });
}
