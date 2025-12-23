/* global WDWMX */
(function () {
  'use strict';

  if (!window.WDWMX) {
    console.error('WDWMX not found. core.js must load first.');
    return;
  }

  const API_BASE = '';

  /* =========================
     Element references
     ========================= */

  const changesBtn     = document.getElementById('changes-btn');
  const changesOverlay = document.getElementById('changes-overlay');
  const changesBoard   = document.getElementById('changes-board');
  const changesClose   = document.getElementById('changes-close');
  const changesList    = document.getElementById('changes-list');

  const reportBtn      = document.getElementById('report-btn');
  const reportOverlay  = document.getElementById('report-overlay');
  const reportModal    = document.getElementById('report-modal');
  const reportClose    = document.getElementById('report-close');
  const reportCancel   = document.getElementById('report-cancel');
  const reportSubmit   = document.getElementById('report-submit');
  const reportDesc     = document.getElementById('report-desc');
  const reportName     = document.getElementById('report-name');
  const reportStatus   = document.getElementById('report-status');

  /* =========================
     Helpers
     ========================= */

  function show(el) {
    if (el) el.style.display = 'block';
  }

  function hide(el) {
    if (el) el.style.display = 'none';
  }

  function getActiveMapCode() {
    return WDWMX.getCompareMode() && WDWMX.getRightCode()
      ? WDWMX.getRightCode()
      : WDWMX.getCurrentCode();
  }

  function getMapViewState() {
    const map = WDWMX.getMap();
    const ol  = WDWMX.ol;

    const view = map.getView();
    const center = ol.proj.toLonLat(view.getCenter());

    return {
      lon: center[0],
      lat: center[1],
      zoom: view.getZoom()
    };
  }

  /* =========================
     Changes board
     ========================= */

  function openChanges() {
    show(changesOverlay);
    show(changesBoard);
    loadChanges();
  }

  function closeChanges() {
    hide(changesOverlay);
    hide(changesBoard);
  }

  async function loadChanges() {
    changesList.innerHTML = '<div class="changes-empty">Loading…</div>';

    try {
      const code = getActiveMapCode();
      const res = await fetch(`${API_BASE}/api/changes?status=approved&map_code=${encodeURIComponent(code)}`);

      if (!res.ok) throw new Error(res.status);

      const items = await res.json();

      if (!items.length) {
        changesList.innerHTML = '<div class="changes-empty">No approved changes yet.</div>';
        return;
      }

      changesList.innerHTML = '';

      items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'changes-item';

        div.innerHTML = `
          <div class="changes-item-title">${item.title || 'Reported change'}</div>
          <div class="changes-item-meta">
            ${item.map_label || item.map_code}
          </div>
        `;

        div.addEventListener('click', () => {
          const map = WDWMX.getMap();
          const ol  = WDWMX.ol;

          if (item.map_code && item.map_code !== WDWMX.getCurrentCode()) {
            WDWMX.setSingleDate(item.map_code);
          }

          const target = ol.proj.fromLonLat([item.lon, item.lat]);

          map.getView().animate({
            center: target,
            zoom: item.zoom || 16,
            duration: 650
          });

          closeChanges();
        });

        changesList.appendChild(div);
      });

    } catch (err) {
      console.error(err);
      changesList.innerHTML =
        '<div class="changes-empty">Failed to load changes.</div>';
    }
  }

  /* =========================
     Report modal
     ========================= */

  function openReport() {
    show(reportOverlay);
    show(reportModal);
    reportStatus.textContent = '';
    reportDesc.value = '';
  }

  function closeReport() {
    hide(reportOverlay);
    hide(reportModal);
    reportSubmit.disabled = false;
    reportStatus.textContent = '';
  }

async function submitReport() {
  // Always show something immediately so it never feels like "nothing happened"
  reportStatus.style.display = 'block';
  reportStatus.style.color = '#444';
  reportStatus.textContent = 'Checking…';

  const desc = (reportDesc.value || '').trim();
  if (!desc) {
    reportStatus.style.color = '#b00020';
    reportStatus.textContent = 'Please describe what changed.';
    return;
  }

  // If your core exposes the map + ol
  const map = WDWMX.getMap?.();
  const ol = WDWMX.ol;

  if (!map || !ol) {
    reportStatus.style.color = '#b00020';
    reportStatus.textContent = 'Map bridge not ready (WDWMX).';
    return;
  }

  const center = ol.proj.toLonLat(map.getView().getCenter());
  const zoom = map.getView().getZoom();
  const code = getActiveMapCode();

  reportSubmit.disabled = true;
  reportStatus.style.color = '#444';
  reportStatus.textContent = 'Sending…';

  const payload = {
    map_code: code,
    map_label: WDWMX.getLabelForCode?.(code) || code,
    lon: center[0],
    lat: center[1],
    zoom,
    description: desc,
    reporter_name: (reportName.value || '').trim() || null
  };

  try {
    const res = await fetch(API_BASE + '/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}${txt ? ` – ${txt}` : ''}`);
    }

    reportStatus.style.color = '#1b5e20';
    reportStatus.textContent = 'Thanks — your report has been sent for review.';
    reportDesc.value = '';

    setTimeout(() => {
      closeOverlay(reportOverlay);
      reportSubmit.disabled = false;
      reportStatus.textContent = '';
      reportStatus.style.display = 'none';
    }, 900);

  } catch (err) {
    console.error('Report submit failed:', err);
    reportStatus.style.color = '#b00020';
    reportStatus.textContent = `Failed to submit: ${err.message || err}`;
    reportSubmit.disabled = false;
  }
}

  

  /* =========================
     Wiring
     ========================= */

  changesBtn?.addEventListener('click', openChanges);
  changesClose?.addEventListener('click', closeChanges);
  changesOverlay?.addEventListener('click', closeChanges);

  reportBtn?.addEventListener('click', openReport);
  reportClose?.addEventListener('click', closeReport);
  reportCancel?.addEventListener('click', closeReport);
  reportOverlay?.addEventListener('click', closeReport);
  reportSubmit?.addEventListener('click', submitReport);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeChanges();
      closeReport();
    }
  });

})();
