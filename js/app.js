/* global WDWMX */
(function () {
  'use strict';

  if (!window.WDWMX) {
    console.error('WDWMX bridge not found. Ensure window.WDWMX is set in index.html.');
    return;
  }

  const API_BASE = ""; // same domain

  // Buttons
  const reportBtn = document.getElementById('report-btn');
  const changesBtn = document.getElementById('changes-btn');

  // Report overlay
  const reportOverlay = document.getElementById('report-overlay');
  const reportClose = document.getElementById('report-close');
  const reportCancel = document.getElementById('report-cancel');
  const reportSubmit = document.getElementById('report-submit');
  const reportDesc = document.getElementById('report-desc');
  const reportName = document.getElementById('report-name');
  const reportStatus = document.getElementById('report-status');

  // Changes overlay
  const changesOverlay = document.getElementById('changes-overlay');
  const changesClose = document.getElementById('changes-close');
  const changesList = document.getElementById('changes-list');

  function openOverlay(el) {
    el.style.display = 'block';
  }

  function closeOverlay(el) {
    el.style.display = 'none';
  }

  function getActiveMapCode() {
    return WDWMX.getCompareMode() && WDWMX.getRightCode()
      ? WDWMX.getRightCode()
      : WDWMX.getCurrentCode();
  }

  async function submitReport() {
    const desc = reportDesc.value.trim();
    const name = reportName.value.trim();

    if (!desc) {
      reportStatus.textContent = 'Please describe what changed.';
      return;
    }

    const map = WDWMX.getMap();
    const ol = WDWMX.ol;

    const center = ol.proj.toLonLat(map.getView().getCenter());
    const zoom = map.getView().getZoom();
    const code = getActiveMapCode();

    reportSubmit.disabled = true;
    reportStatus.textContent = 'Submitting…';

    try {
      const res = await fetch(API_BASE + '/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          map_code: code,
          map_label: WDWMX.getLabelForCode(code),
          lon: center[0],
          lat: center[1],
          zoom,
          description: desc,
          reporter_name: name || null
        })
      });

      if (!res.ok) throw new Error(res.status);

      reportStatus.textContent = 'Thanks — your report has been sent for review.';
      reportDesc.value = '';

      setTimeout(() => {
        closeOverlay(reportOverlay);
        reportSubmit.disabled = false;
        reportStatus.textContent = '';
      }, 900);

    } catch (err) {
      console.error(err);
      reportStatus.textContent = 'Failed to submit. Please try again.';
      reportSubmit.disabled = false;
    }
  }

  async function loadChanges() {
    changesList.innerHTML = '<div class="changes-empty">Loading…</div>';

    try {
      const res = await fetch(API_BASE + '/api/changes?status=approved&limit=50');
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
          <div class="changes-item-title">Reported change</div>
          <div class="changes-item-meta">
            ${item.map_label || item.map_code}
          </div>
        `;

        div.addEventListener('click', () => {
          if (!WDWMX.getCompareMode() && item.map_code !== WDWMX.getCurrentCode()) {
            WDWMX.setSingleDate(item.map_code);
          }

          const target = WDWMX.ol.proj.fromLonLat([item.lon, item.lat]);
          WDWMX.getMap().getView().animate({
            center: target,
            zoom: item.zoom || 16,
            duration: 650
          });

          closeOverlay(changesOverlay);
        });

        changesList.appendChild(div);
      });

    } catch (err) {
      console.error(err);
      changesList.innerHTML = '<div class="changes-empty">Failed to load changes.</div>';
    }
  }

  // Wiring
  reportBtn?.addEventListener('click', () => openOverlay(reportOverlay));
  reportClose.addEventListener('click', () => closeOverlay(reportOverlay));
  reportCancel.addEventListener('click', () => closeOverlay(reportOverlay));
  reportSubmit.addEventListener('click', submitReport);

  changesBtn?.addEventListener('click', () => {
    openOverlay(changesOverlay);
    loadChanges();
  });

  changesClose.addEventListener('click', () => closeOverlay(changesOverlay));

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeOverlay(reportOverlay);
      closeOverlay(changesOverlay);
    }
  });
})();
