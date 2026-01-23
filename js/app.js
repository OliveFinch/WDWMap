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

    loadChangesAllApproved().catch((err) => {
      console.warn(err);
      if (changesMeta) changesMeta.textContent = 'Could not load changes. Check API_BASE and Worker routes.';
      if (changesList) {
        changesList.innerHTML = '';
        const d = document.createElement('div');
        d.style.padding = '12px';
        d.style.color = '#666';
        d.style.fontSize = '13px';
        d.textContent = 'Failed to load map changes.';
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

  // We only show Map changes while in Disney map view (not satellite).
  function isDisneyView() {
    try {
      if (typeof WDWMX.getShowingDisney === 'function') return !!WDWMX.getShowingDisney();
      if (typeof WDWMX.isShowingDisney === 'function') return !!WDWMX.isShowingDisney();
      if (typeof WDWMX.getMapMode === 'function') return (WDWMX.getMapMode() === 'disney');
    } catch {}
    return true; // fail-open
  }

  function ensureDisneyView() {
    try {
      if (typeof WDWMX.setMapMode === 'function') {
        WDWMX.setMapMode('disney');
        return true;
      }
      if (typeof WDWMX.setShowingDisney === 'function') {
        WDWMX.setShowingDisney(true);
        return true;
      }
      if (typeof WDWMX.showDisney === 'function') {
        WDWMX.showDisney();
        return true;
      }
      if (typeof WDWMX.setSatellite === 'function') {
        WDWMX.setSatellite(false);
        return true;
      }
    } catch {}
    return false;
  }

  function normalizeItems(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    if (data && Array.isArray(data.results)) return data.results;
    return [];
  }

  function formatDateOnly(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return safeText(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
  }

  function labelForMapVersion(code) {
    if (!code) return '';
    try {
      if (WDWMX.getLabelForCode) return WDWMX.getLabelForCode(code) || code;
    } catch {}
    return code;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function normalizeCategory(v) {
    const s = safeText(v, '').trim().toLowerCase();
    if (!s) return 'other';
    // Accept either your UI values or future aliases
    if (s === 'new') return 'new';
    if (s === 'changed' || s === 'change') return 'changed';
    if (s === 'removed' || s === 'remove') return 'removed';
    if (s === 'other') return 'other';
    if (s === 'general') return 'other';
    return s;
  }

  function prettyCategory(v) {
    const c = normalizeCategory(v);
    if (c === 'new') return 'New';
    if (c === 'changed') return 'Changed';
    if (c === 'removed') return 'Removed';
    if (c === 'other') return 'Other';
    // if you add more categories later, show them safely
    return c.charAt(0).toUpperCase() + c.slice(1);
  }

  // =========================
  // servers2.json ordering (same as date picker)
  // =========================
  let __serversIndexPromise = null;

  function tryGetServersFromWDWMX() {
    try {
      if (typeof WDWMX.getServers === 'function') return WDWMX.getServers();
      if (Array.isArray(WDWMX.servers)) return WDWMX.servers;
      if (Array.isArray(WDWMX.SERVERS)) return WDWMX.SERVERS;
    } catch {}
    return null;
  }

  async function loadServersIndex() {
    if (__serversIndexPromise) return __serversIndexPromise;

    __serversIndexPromise = (async () => {
      let list = tryGetServersFromWDWMX();

      if (!list) {
        const res = await fetch('servers2.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(`Could not load servers2.json: ${res.status}`);
        list = await res.json();
      }

      const arr = Array.isArray(list) ? list : (Array.isArray(list.items) ? list.items : []);
      const indexByCode = new Map();

      arr.forEach((s, i) => {
        const code =
          (s && (s.code || s.server_id || s.serverId || s.id || s.value)) != null
            ? String(s.code || s.server_id || s.serverId || s.id || s.value)
            : null;

        if (code) indexByCode.set(code, i);
      });

      return { arr, indexByCode };
    })();

    return __serversIndexPromise;
  }

  // =========================
  // API: Map changes (ALL approved, across all maps)
  // =========================
  async function loadChangesAllApproved() {
    if (!isDisneyView()) {
      if (changesMeta) changesMeta.textContent = 'Map changes are available in Disney map view only.';
      if (changesList) {
        changesList.innerHTML = '';
        const d = document.createElement('div');
        d.style.padding = '12px';
        d.style.color = '#666';
        d.style.fontSize = '13px';
        d.textContent = 'Switch back to Disney map view (mouse icon) to view and jump to map changes.';
        changesList.appendChild(d);
      }
      return;
    }

    const activeCode = getActiveMapCode();

    if (changesMeta) {
      changesMeta.textContent = 'Highlighted changes reflect currently selected map';
    }

    const url = `${API_BASE}/api/changes-feed?limit=200`;
    const res = await fetch(url, { method: 'GET' });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Changes API failed: ${res.status} ${txt}`);
    }

    const data = await res.json();
    const items = normalizeItems(data);

    if (!changesList) return;
    changesList.innerHTML = '';

    if (!items.length) {
      const empty = document.createElement('div');
      empty.style.padding = '12px';
      empty.style.color = '#666';
      empty.style.fontSize = '13px';
      empty.textContent = 'No approved changes yet.';
      changesList.appendChild(empty);
      return;
    }

    // Sort using servers2.json order (newer maps first)
    let serversIndex = null;
    try {
      serversIndex = await loadServersIndex();
    } catch (e) {
      console.warn('servers2.json ordering unavailable; falling back to approved_at ordering.', e);
    }

    if (serversIndex && serversIndex.indexByCode && serversIndex.indexByCode.size) {
      items.sort((a, b) => {
        const ca = String(a.map_version || a.mapVersion || a.server_id || a.serverId || '');
        const cb = String(b.map_version || b.mapVersion || b.server_id || b.serverId || '');

        const ia = serversIndex.indexByCode.has(ca) ? serversIndex.indexByCode.get(ca) : -1;
        const ib = serversIndex.indexByCode.has(cb) ? serversIndex.indexByCode.get(cb) : -1;

        if (ib !== ia) return ib - ia;

        const da = new Date(a.approved_at || a.created_at || 0).getTime();
        const db = new Date(b.approved_at || b.created_at || 0).getTime();
        return db - da;
      });
    } else {
      items.sort((a, b) => {
        const da = new Date(a.approved_at || a.created_at || 0).getTime();
        const db = new Date(b.approved_at || b.created_at || 0).getTime();
        return db - da;
      });
    }

    items.forEach((it) => {
      const mapVersion = safeText(it.map_version || it.mapVersion || it.server_id || it.serverId || '');
      const mapLabel = labelForMapVersion(mapVersion);

      const btn = document.createElement('button');
      btn.className = 'change-item';

      if (activeCode && mapVersion && String(mapVersion) === String(activeCode)) {
        btn.classList.add('change-item-active');
      }

      // Main line: description
      const title = document.createElement('p');
      title.className = 'change-title';
      title.textContent = safeText(it.description || 'Change');
      btn.appendChild(title);

      // Line 2: map label + category (type)
      const line2 = document.createElement('p');
      line2.className = 'change-sub';

      const cat = prettyCategory(it.category);
      const mapText = mapLabel || mapVersion || '';
      line2.textContent = mapText ? `${mapText} · ${cat}` : cat;
      btn.appendChild(line2);

      // Line 3: Reported by X on DATE (no time)
      const line3 = document.createElement('p');
      line3.className = 'change-sub';

      const who = safeText(it.display_name || '', '').trim() || 'anonymous';
      const when = formatDateOnly(it.created_at || it.approved_at);

      line3.textContent = `Reported by ${who}${when ? ` on ${when}` : ''}`;
      btn.appendChild(line3);

      btn.addEventListener('click', async () => {
        const ol = WDWMX.ol;
        const map = WDWMX.getMap && WDWMX.getMap();
        if (!ol || !map) return;

        ensureDisneyView();

        if (mapVersion && WDWMX.setSingleDate) {
          try { WDWMX.setSingleDate(mapVersion); } catch {}
        }

        await sleep(60);

        const lng = Number(it.lng);
        const lat = Number(it.lat);
        const z = Number(it.zoom);

        if (Number.isFinite(lng) && Number.isFinite(lat)) {
          const target = ol.proj.fromLonLat([lng, lat]);
          const targetZoom = Number.isFinite(z) ? z : map.getView().getZoom();
          closeChangesBoard();
          map.getView().animate({ center: target, zoom: targetZoom, duration: 650 });
        } else {
          closeChangesBoard();
        }
      });

      changesList.appendChild(btn);
    });
  }

  // =========================
  // API: Report
  // =========================
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

    const lat = Number(state.center_lat);
    const lng = Number(state.center_lng);
    const zoom = Number(state.zoom);

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) {
      setStatus('Could not read map centre/zoom. Try moving the map a little and retry.', '#b00020');
      return;
    }

    // IMPORTANT: use the dropdown value as category, so it shows in Map changes.
    const chosenCategory = normalizeCategory(reportType && reportType.value);

    const payload = {
      serverId: code,
      mapVersion: code,
      description: desc,
      lat,
      lng,
      zoom,
      bboxWest: Number.isFinite(Number(state.bbox_w)) ? Number(state.bbox_w) : null,
      bboxSouth: Number.isFinite(Number(state.bbox_s)) ? Number(state.bbox_s) : null,
      bboxEast: Number.isFinite(Number(state.bbox_e)) ? Number(state.bbox_e) : null,
      bboxNorth: Number.isFinite(Number(state.bbox_n)) ? Number(state.bbox_n) : null,
      category: chosenCategory,
      displayName: safeText(reportName && reportName.value).trim() || null
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
      }, 2550);

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
    else {
      // If the user opened the report flow from the Recent changes panel,
      // close it first so overlays don't stack.
      closeChangesBoard();
      openReportModal();
    }
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
