/* global WDWMX */
(function () {
  'use strict';

  // =========================
  // Config
  // =========================
  // Use your Worker origin (no trailing slash). If you bind the Worker on the same domain,
  // set this to "" instead.
  const API_BASE = 'https://wdw-magic-explorer-api.gullet-erase2v.workers.dev';

  // =========================
  // Guard: core.js bridge
  // =========================
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

  if (!reportBtn || !changesBtn) {
    console.warn('Report/Changes buttons not found in DOM.');
  }

  // =========================
  // Small helpers
  // =========================
  function safeText(v, fallback = '') {
    if (v === null || v === undefined) return fallback;
    return String(v);
  }

  function setStatus(el, text, color) {
    if (!el) return;
    el.style.display = 'block';
    el.style.color = color || '#444';
    el.textContent = text || '';
  }

  function clearStatus(el) {
    if (!el) return;
    el.textContent = '';
    el.style.display = 'none';
  }

  function openReportModal() {
    if (!reportOverlay || !reportModal) return;

    reportOverlay.style.display = 'block';
    reportModal.style.display = 'block';
    reportOverlay.setAttribute('aria-hidden', 'false');
    clearStatus(reportStatus);
    if (reportSubmit) reportSubmit.disabled = false;

    // Optional: update hint text if you keep a hint element in markup
    // (Your HTML uses an inline <p class="hint"> already, so nothing to update here.)
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

  function getActiveMapCode() {
    // Prefer "right" date if you are in compare mode, otherwise current
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
    const code = getActiveMapCode() || '';
    const label = (WDWMX.getLabelForCode && WDWMX.getLabelForCode(code)) || code;

    if (changesMeta) changesMeta.textContent = `Map: ${label || '(unknown)'}`;

    // Your earlier inline implementation used:
    //   GET /api/changes?map_code=...&limit=50
    const url = `${API_BASE}/api/changes?map_code=${encodeURIComponent(code)}&limit=50`;
    const res = await fetch(url, { method: 'GET' });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Changes API failed: ${res.status} ${txt}`);
    }

    const data = await res.json();
    const items = normalizeItems(data);

    if (!changesList) return;

    if (!items.length) {
      changesList.innerHTML = '';
      const empty = document.createElement('div');
      empty.style.padding = '12px';
      empty.style.color = '#666';
      empty.style.fontSize = '13px';
      empty.textContent = 'No approved changes yet for this map version.';
      changesList.appendChild(empty);
      return;
    }

    changesList.innerHTML = '';
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
  // API: Report
  // =========================
  async function submitReport() {
    if (!reportDesc || !reportStatus || !reportSubmit) return;

    const desc = safeText(reportDesc.value).trim();
    if (!desc) {
      setStatus(reportStatus, 'Please describe what changed.', '#b00020');
      return;
    }

    const code = getActiveMapCode();
    if (!code) {
      setStatus(reportStatus, 'Could not determine current map version.', '#b00020');
      return;
    }

    const state = getMapState();
    if (!state) {
      setStatus(reportStatus, 'Map not ready yet.', '#b00020');
      return;
    }

    reportSubmit.disabled = true;
    setStatus(reportStatus, 'Sending…', '#444');

    const payload = {
      map_code: code,
      map_label: (WDWMX.getLabelForCode && WDWMX.getLabelForCode(code)) || code,
      // If core exposes mode: keep this optional
      map_mode: (WDWMX.getShowingDisney && WDWMX.getShowingDisney()) ? 'disney' : 'satellite',
      reporter_name: safeText(reportName && reportName.value).trim() || null,
      change_type: safeText(reportType && reportType.value).trim() || 'other',
      description: desc,
      view: state
    };

    const url = `${API_BASE}/api/reports`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        reportSubmit.disabled = false;
        setStatus(
          reportStatus,
          `Failed to submit: HTTP ${res.status}${txt ? ' — ' + txt : ''}`,
          '#b00020'
        );
        return;
      }

      setStatus(reportStatus, 'Report sent. Thanks. It will appear once approved.', '#1b5e20');

      // Light reset
      reportDesc.value = '';
      if (reportType) reportType.value = 'new';

      setTimeout(() => {
        closeReportModal();
        reportSubmit.disabled = false;
        clearStatus(reportStatus);
      }, 850);

    } catch (err) {
      console.error(err);
      reportSubmit.disabled = false;
      setStatus(reportStatus, 'Failed to submit. Check your Worker and CORS settings.', '#b00020');
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

  // Clicking the dim backdrop should close
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

  // =========================
  // Sanity logs (optional)
  // =========================
  // Uncomment if you want a quick check that you’re hitting the right origin.
  // console.log('app.js loaded. API_BASE =', API_BASE);
})();
