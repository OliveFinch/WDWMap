/* global WDWMX */
(function () {
  'use strict';

  // =========================
  // Config
  // =========================
  const API_BASE = 'https://wdw-magic-explorer-api.gullet-erase2v.workers.dev';

  if (!window.WDWMX) {
    console.error('WDWMX bridge not found. Ensure core.js loads before app.js and sets window.WDWMX.');
    return;
  }

  // =========================
  // DOM
  // =========================
  const reportBtn = document.getElementById('report-btn');
  const changesBtn = document.getElementById('changes-btn');

  const reportOverlay = document.getElementById('report-overlay');
  const reportModal = document.getElementById('report-modal');
  const reportClose = document.getElementById('report-close');
  const reportCancel = document.getElementById('report-cancel');
  const reportSubmit = document.getElementById('report-submit');
  const reportName = document.getElementById('report-name');
  const reportType = document.getElementById('report-type');
  const reportDesc = document.getElementById('report-desc');
  const reportStatus = document.getElementById('report-status');

  const changesOverlay = document.getElementById('changes-overlay');
  const changesBoard = document.getElementById('changes-board');
  const changesClose = document.getElementById('changes-close');
  const changesMeta = document.getElementById('changes-meta');
  const changesList = document.getElementById('changes-list');

  // =========================
  // Helpers
  // =========================
  function safeText(v, fallback = '') {
    if (v === null || v === undefined) return fallback;
    return String(v);
  }

  function setStatus(text, color) {
    if (!reportStatus) return;
    reportStatus.style.display = 'block';
    reportStatus.style.color = color || '#444';
    reportStatus.textContent = text || '';
  }

  function clearStatus() {
    if (!reportStatus) return;
    reportStatus.textContent = '';
    reportStatus.style.display = 'none';
  }

  function openReportModal() {
    if (!reportOverlay || !reportModal) return;
    reportOverlay.style.display = 'block';
    reportModal.style.display = 'block';
    reportOverlay.setAttribute('aria-hidden', 'false');
    clearStatus();
    if (reportSubmit) reportSubmit.disabled = false;
  }

  function closeReportModal() {
    if (!reportOverlay || !reportModal) return;
    reportOverlay.style.display = 'none';
    reportModal.style.display = 'none';
    reportOverlay.setAttribute('aria-hidden', 'true');
  }

  function openChangesBoard() {
    if (!changesOverlay || !changesBoard) return;

    changesOverlay.style.display = 'block';
    changesBoard.style.display = 'block';
    changesOverlay.setAttribute('aria-hidden', 'false');

    if (changesMeta) changesMeta.textContent = 'Loading…';
    if (changesList) changesList.innerHTML = '';

    loadChanges().catch((err) => {
      console.warn(err);
      if (changesMeta) changesMeta.textContent = 'Could not load changes. Check API_BASE and Worker routes.';
      if (changesList) {
        changesList.innerHTML = '';
        const d = document.createElement('div');
        d.style.padding = '12px';
        d.style.color = '#666';
        d.style.fontSize = '13px';
        d.textContent = 'Failed to load approved changes.';
        changesList.appendChild(d);
      }
    });
  }

  function closeChangesBoard() {
    if (!changesOverlay || !changesBoard) return;
    changesOverlay.style.display = 'none';
    changesBoard.style.display = 'none';
    changesOverlay.setAttribute('aria-hidden', 'true');
  }

  // Prefer right code in compare mode, else current
  function getActiveMapCode() {
    try {
      if (WDWMX.getCompareMode && WDWMX.getCompareMode()) {
        const r = WDWMX.getRightCode && WDWMX.getRightCode();
        if (r) return r;
      }
      return WDWMX.getCurrentCode ? WDWMX.getCurrentCode() : null;
    } catch {
      return null;
    }
  }

  function getMapState() {
    const map = WDWMX.getMap && WDWMX.getMap();
    const ol = WDWMX.ol;
    if (!map || !ol) return null;

    const view = map.getView();
    const center3857 = view.getCenter();
    const zoom = view.getZoom();

    const extent3857 = view.calculateExtent(map.getSize());
    const extent4326 = ol.proj.transformExtent(extent3857, 'EPSG:3857', 'EPSG:4326');
    const center4326 = ol.proj.toLonLat(center3857);

    return {
      zoom,
      center_lng: center4326[0],
      center_lat: center4326[1],
      bbox_w: extent4326[0],
      bbox_s: extent4326[1],
      bbox_e: extent4326[2],
      bbox_n: extent4326[3]
    };
  }

  function normalizeItems(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    return [];
  }

  function formatWhen(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return safeText(iso);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // =========================
  // API: Changes
  // =========================
  async function loadChanges() {
    // If your Worker’s changes endpoint is global, keep it simple.
    // If it supports filtering by mapVersion/serverId, we can add that later.
    const url = `${API_BASE}/api/changes?limit=50`;
    const res = await fetch(url, { method: 'GET' });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Changes API failed: ${res.status} ${txt}`);
    }

    const data = await res.json();
    const items = normalizeItems(data);

    if (changesList) changesList.innerHTML = '';

    if (changesMeta) {
      const code = getActiveMapCode() || '';
      const label = (WDWMX.getLabelForCode && WDWMX.getLabelForCode(code)) || code;
      changesMeta.textContent = label ? `Map: ${label}` : 'Recent changes';
    }

    if (!changesList) return;

    if (!items.length) {
      const empty = document.createElement('div');
      empty.style.padding = '12px';
      empty.style.color = '#666';
      empty.style.fontSize = '13px';
      empty.textContent = 'No approved changes yet.';
      changesList.appendChild(empty);
      return;
    }

    items.forEach((it) => {
      const btn = document.createElement('button');
      btn.className = 'change-item';

      const title = document.createElement('p');
      title.className = 'change-title';
      title.textContent = safeText(it.title || it.summary || it.type || 'Change');

      const sub = document.createElement('p');
      sub.className = 'change-sub';

      const who = it.reporter_name ? `by ${it.reporter_name}` : 'by anonymous';
      const when = formatWhen(it.created_at || it.approved_at || it.submitted_at);
      const desc = safeText(it.description || it.details || '', '');

      sub.textContent = `${who}${when ? ' · ' + when : ''}${desc ? ' · ' + desc : ''}`;

      btn.appendChild(title);
      btn.appendChild(sub);

      btn.addEventListener('click', () => {
        const ol = WDWMX.ol;
        const map = WDWMX.getMap && WDWMX.getMap();
        if (!ol || !map) return;

        const lng = Number(it.center_lng ?? it.lng ?? it.lon);
        const lat = Number(it.center_lat ?? it.lat);
        const z = Number(it.zoom ?? it.view_zoom);

        if (Number.isFinite(lng) && Number.isFinite(lat)) {
          const target = ol.proj.fromLonLat([lng, lat]);
          const targetZoom = Number.isFinite(z) ? z : map.getView().getZoom();
          closeChangesBoard();
          map.getView().animate({ center: target, zoom: targetZoom, duration: 650 });
        }
      });

      changesList.appendChild(btn);
    });
  }

  // =========================
  // API: Report (FIXED FIELD NAMES)
  // =========================


  async function submitReport() {
  const desc = safeText(reportDesc && reportDesc.value).trim();
  if (!desc) {
    setStatus('Please describe what changed.', '#b00020');
    return;
  }

  const code = getActiveMapCode();
  if (!code) {
    setStatus('Could not determine current map version.', '#b00020');
    return;
  }

  const state = getMapState();
  if (!state) {
    setStatus('Map not ready yet.', '#b00020');
    return;
  }

  // IMPORTANT: Worker expects top-level lat/lng/zoom as numbers
  const lat = Number(state.center_lat);
  const lng = Number(state.center_lng);
  const zoom = Number(state.zoom);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) {
    setStatus('Could not read map centre/zoom. Try moving the map a little and retry.', '#b00020');
    return;
  }

  // Worker required fields (from your previous errors)
  const payload = {
    serverId: code,
    mapVersion: code,
    description: desc,

    // now included exactly as the Worker wants
    lat,
    lng,
    zoom,

    // optional extras (only if your Worker tolerates them)
    reporterName: safeText(reportName && reportName.value).trim() || null,
    changeType: safeText(reportType && reportType.value).trim() || 'other'
  };

  if (reportSubmit) reportSubmit.disabled = true;
  setStatus('Sending…', '#444');

  try {
    const res = await fetch(`${API_BASE}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      if (reportSubmit) reportSubmit.disabled = false;
      setStatus(`Failed to submit: HTTP ${res.status}${txt ? ' — ' + txt : ''}`, '#b00020');
      return;
    }

    setStatus('Report sent. Thanks. It will appear once approved.', '#1b5e20');

    if (reportDesc) reportDesc.value = '';
    if (reportType) reportType.value = 'new';

    setTimeout(() => {
      closeReportModal();
      if (reportSubmit) reportSubmit.disabled = false;
      clearStatus();
    }, 850);

  } catch (err) {
    console.error(err);
    if (reportSubmit) reportSubmit.disabled = false;
    setStatus('Failed to submit. Check your Worker and CORS settings.', '#b00020');
  }
}
  

  // =========================
  // Wiring
  // =========================
  reportBtn && reportBtn.addEventListener('click', () => {
    if (reportModal && reportModal.style.display === 'block') closeReportModal();
    else openReportModal();
  });

  reportClose && reportClose.addEventListener('click', closeReportModal);
  reportCancel && reportCancel.addEventListener('click', closeReportModal);
  reportOverlay && reportOverlay.addEventListener('click', closeReportModal);
  reportSubmit && reportSubmit.addEventListener('click', submitReport);

  changesBtn && changesBtn.addEventListener('click', () => {
    if (changesBoard && changesBoard.style.display === 'block') closeChangesBoard();
    else openChangesBoard();
  });

  changesClose && changesClose.addEventListener('click', closeChangesBoard);
  changesOverlay && changesOverlay.addEventListener('click', closeChangesBoard);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeReportModal();
      closeChangesBoard();
    }
  });
})();
