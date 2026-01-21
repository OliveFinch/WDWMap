/* global ol */
(function () {
  'use strict';

  // Expose a bridge for app.js (reporting UI)
  window.WDWMX = window.WDWMX || {};

  // =====================
  // Core config
  // =====================
  const DISNEY_TILE_URL = (code) =>
    `https://cdn6.parksmedia.wdprapps.disney.com/media/maps/prod/${code}/{z}/{x}/{y}.jpg`;

  const ESRI_TILE_URL = (esriId) =>
    `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${esriId}/{z}/{y}/{x}`;

  const ROADS_TILE_URL = 'https://mt1.google.com/vt/lyrs=h&x={x}&y={y}&z={z}';

  // =====================
  // App State
  // =====================
  let serverOptions = [];
  let currentCode = null;
  let leftCode = null;
  let rightCode = null;
  let lastTwoDates = [null, null];

  let showingDisney = true; // false = ESRI
  let compareMode = false;
  let highlightMode = false;
  let roadsOn = false;
  let showSensitivity = false;

  // Map & layers
  let map, disneyLayer, esriLayer, roadsLayer;
  let leftLayer = null, rightLayer = null, highlightLayer = null;

  // Compare UI state
  let swipeRatio = 0.5;

  // DOM
  const dateBtn = document.getElementById('date-btn');
  const datePopup = document.getElementById('date-popup');
  const leftDateBtn = document.getElementById('left-date-btn');
  const leftDatePopup = document.getElementById('left-date-popup');
  const toggleBtn = document.getElementById('toggle-btn');
  const toggleIconImg = document.getElementById('toggle-icon-img');
  const compareBtn = document.getElementById('compare-btn');
  const highlightBtn = document.getElementById('highlight-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const quickSwitchBtn = document.getElementById('quick-switch-btn');
  const roadsBtn = document.getElementById('roads-btn');
  const roadsIconImg = document.getElementById('roads-icon-img');
  const findmeBtn = document.getElementById('findme-btn');
  const currentDateDisplay = document.getElementById('current-date-display');
  const swipeThumb = document.getElementById('swipe-thumb');
  const swipeHandle = document.getElementById('swipe-handle');
  const sensitivityRow = document.getElementById('sensitivity-row');
  const sensitivitySlider = document.getElementById('sensitivity-slider');
  const zoomInBtn = document.getElementById('zoom-in-btn');
  const zoomOutBtn = document.getElementById('zoom-out-btn');

  const infoIcon = document.getElementById('info-icon');
  const infoOverlay = document.getElementById('info-overlay');
  const infoClose = document.getElementById('info-close');

  // Extent
  const disneyWorldExtent = ol.proj.transformExtent(
    [-81.9200, 28.1772, -81.2244, 28.6390],
    'EPSG:4326',
    'EPSG:3857'
  );

  // Sensitivity (reversed slider mapping)
  function sliderToThreshold(val) {
    const min = parseInt(sensitivitySlider.min, 10);
    const max = parseInt(sensitivitySlider.max, 10);
    return (min + max) - val;
  }
  let currentThreshold = sliderToThreshold(parseInt(sensitivitySlider.value, 10));

  // =====================
  // Lookups
  // =====================
  function getLabelForCode(code) {
    const rec = serverOptions.find((o) => o.code === code);
    return rec ? rec.label : '';
  }
  function getEsriIdForCode(code) {
    const rec = serverOptions.find((o) => o.code === code);
    return rec && rec.esri_id ? rec.esri_id : '';
  }
  function getEsriLabelForCode(code) {
    const rec = serverOptions.find((o) => o.code === code);
    return rec && rec.esri_label ? rec.esri_label : '';
  }
  function getPreviousCode(code) {
    const i = serverOptions.findIndex((o) => o.code === code);
    return i > 0 ? serverOptions[i - 1].code : serverOptions[0].code;
  }

  // =====================
  // Layers
  // =====================
  function makeDisneyLayer(code) {
    return new ol.layer.Tile({
      source: new ol.source.XYZ({
        url: DISNEY_TILE_URL(code),
        minZoom: 0,
        maxZoom: 20,
      }),
      visible: true,
    });
  }

  function makeEsriLayer(esriId) {
    if (!esriId) return null;
    const lyr = new ol.layer.Tile({
      source: new ol.source.XYZ({
        url: ESRI_TILE_URL(esriId),
        minZoom: 0,
        maxZoom: 20,
      }),
      visible: false,
    });
    lyr.set('esri_id', esriId);
    return lyr;
  }

  function makeRoadsLayer() {
    return new ol.layer.Tile({
      source: new ol.source.XYZ({
        url: ROADS_TILE_URL,
        minZoom: 0,
        maxZoom: 20,
      }),
      visible: false,
      opacity: 0.85,
    });
  }

  // =====================
  // Highlight layer
  // =====================
  function rgb2lab(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

    let x = r * 0.4124 + g * 0.3576 + b * 0.1805;
    let y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    let z = r * 0.0193 + g * 0.1192 + b * 0.9505;

    [x, y, z] = [x / 0.95047, y / 1.0, z / 1.08883];
    x = x > 0.008856 ? Math.pow(x, 1 / 3) : (7.787 * x) + 16 / 116;
    y = y > 0.008856 ? Math.pow(y, 1 / 3) : (7.787 * y) + 16 / 116;
    z = z > 0.008856 ? Math.pow(z, 1 / 3) : (7.787 * z) + 16 / 116;
    return [(116 * y) - 16, 500 * (x - y), 200 * (y - z)];
  }

  function deltaE(a, b) {
    const dL = a[0] - b[0];
    const da = a[1] - b[1];
    const db = a[2] - b[2];
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  function makeHighlightLayer(baseCode, compareCode) {
    const baseUrlTpl = DISNEY_TILE_URL(baseCode);
    const compareUrlTpl = DISNEY_TILE_URL(compareCode);

    return new ol.layer.Tile({
      source: new ol.source.XYZ({
        url: baseUrlTpl,
        maxZoom: 20,
        crossOrigin: 'anonymous',
        tileLoadFunction: function (tile, src) {
          const zxy = tile.tileCoord;
          const compareUrl = compareUrlTpl
            .replace('{z}', zxy[0])
            .replace('{x}', zxy[1])
            .replace('{y}', zxy[2]);

          const baseImg = new Image();
          baseImg.crossOrigin = 'anonymous';

          baseImg.onload = function () {
            const cmpImg = new Image();
            cmpImg.crossOrigin = 'anonymous';

            cmpImg.onload = function () {
              const w = baseImg.width || cmpImg.width || 256;
              const h = baseImg.height || cmpImg.height || 256;

              const canvas = document.createElement('canvas');
              canvas.width = w; canvas.height = h;
              const ctx = canvas.getContext('2d');

              const off1 = document.createElement('canvas');
              off1.width = w; off1.height = h;
              const c1 = off1.getContext('2d');
              c1.drawImage(baseImg, 0, 0, w, h);
              const d1 = c1.getImageData(0, 0, w, h);

              const off2 = document.createElement('canvas');
              off2.width = w; off2.height = h;
              const c2 = off2.getContext('2d');
              c2.drawImage(cmpImg, 0, 0, w, h);
              const d2 = c2.getImageData(0, 0, w, h);

              const out = ctx.createImageData(w, h);
              const threshold = currentThreshold;

              for (let i = 0; i < d1.data.length; i += 4) {
                const r1 = d1.data[i], g1 = d1.data[i + 1], b1 = d1.data[i + 2], a1 = d1.data[i + 3];
                const r2 = d2.data[i], g2 = d2.data[i + 1], b2 = d2.data[i + 2];

                const lab1 = rgb2lab(r1, g1, b1);
                const lab2 = rgb2lab(r2, g2, b2);

                if (deltaE(lab1, lab2) > threshold) {
                  out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 0; out.data[i + 3] = 200;
                } else {
                  const gray = 0.3 * r1 + 0.59 * g1 + 0.11 * b1;
                  out.data[i] = out.data[i + 1] = out.data[i + 2] = gray;
                  out.data[i + 3] = a1;
                }
              }

              ctx.putImageData(out, 0, 0);
              tile.getImage().src = canvas.toDataURL();
            };

            cmpImg.onerror = function () { tile.getImage().src = baseImg.src; };
            cmpImg.src = compareUrl;
          };

          baseImg.onerror = function () {
            const blank = document.createElement('canvas');
            blank.width = blank.height = 256;
            tile.getImage().src = blank.toDataURL();
          };

          baseImg.src = src;
        }
      })
    });
  }

  // =====================
  // Map init
  // =====================
  function initMap() {
    disneyLayer = makeDisneyLayer(currentCode);
    esriLayer = makeEsriLayer(getEsriIdForCode(currentCode));
    roadsLayer = makeRoadsLayer();

    disneyLayer.getSource().set('extent', disneyWorldExtent);
    if (esriLayer) esriLayer.getSource().set('extent', disneyWorldExtent);
    roadsLayer.getSource().set('extent', disneyWorldExtent);

    map = new ol.Map({
      target: 'map',
      layers: [disneyLayer, esriLayer, roadsLayer].filter(Boolean),
      view: new ol.View({
        center: ol.proj.fromLonLat([-81.566575, 28.386606]),
        zoom: 13,
        minZoom: 0,
        maxZoom: 20,
        extent: disneyWorldExtent
      }),
      controls: ol.control.defaults.defaults({ zoom: false }),
      interactions: ol.interaction.defaults.defaults({
        altShiftDragRotate: false,
        pinchRotate: false
      })
    });

    map.on('rendercomplete', updateSwipeUI);
    const ro = new ResizeObserver(updateSwipeUI);
    ro.observe(document.getElementById('map'));
    window.addEventListener('resize', updateSwipeUI);
    window.addEventListener('scroll', updateSwipeUI, { passive: true });

    // Dock quick pan
    const dock = document.getElementById('location-dock');
    dock.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [lonStr, latStr] = (btn.dataset.coords || '').split(',');
        const lon = parseFloat(lonStr);
        const lat = parseFloat(latStr);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

        const target = ol.proj.fromLonLat([lon, lat]);
        const targetZoom = Number.isFinite(parseFloat(btn.dataset.zoom))
          ? parseFloat(btn.dataset.zoom)
          : 16;

        map.getView().animate({ center: target, zoom: targetZoom, duration: 600 });
      });
    });
  }

// Double-tap to zoom at finger position + optional hold-and-drag zoom (mobile helper)
function enableDoubleTapHoldZoom() {
  const mapDiv = map.getTargetElement();
  if (!mapDiv) return;

  let lastTap = 0;
  let isHoldZoom = false;

  let startY = 0;
  let startZoom = 0;

  // Anchor (the thing we keep under the finger)
  let anchorPx = null;     // [x,y] in map viewport pixels
  let anchorCoord = null;  // map coord (EPSG:3857)

  // Used to detect "double tap without drag" vs hold-drag
  let movedDuringHold = false;

  function clientToMapPixel(touch) {
    const rect = mapDiv.getBoundingClientRect();
    return [touch.clientX - rect.left, touch.clientY - rect.top];
  }

  function centerForAnchorAtZoom(view, coord, px, zoom) {
    const size = map.getSize();
    if (!size) return view.getCenter();

    // OL view is not rotated in your config (pinchRotate disabled), so simple math is fine.
    const res = view.getResolutionForZoom(zoom);

    // px is from top-left; map coords have +Y upwards, screen has +Y downwards
    const dx = (px[0] - size[0] / 2) * res;
    const dy = (size[1] / 2 - px[1]) * res;

    return [coord[0] - dx, coord[1] - dy];
  }

  function applyZoomAnchored(newZoom) {
    const view = map.getView();
    if (!anchorPx || !anchorCoord) return;

    newZoom = Math.max(view.getMinZoom(), Math.min(view.getMaxZoom(), newZoom));
    const newCenter = centerForAnchorAtZoom(view, anchorCoord, anchorPx, newZoom);

    // Set center + zoom together so the anchor stays pinned under the finger
    view.setCenter(newCenter);
    view.setZoom(newZoom);
  }

  function moveHandler(e) {
    if (!isHoldZoom || !e.touches || e.touches.length !== 1) return;

    e.preventDefault();

    const dy = e.touches[0].clientY - startY;
    if (Math.abs(dy) > 6) movedDuringHold = true;

    // Drag up = zoom in, drag down = zoom out
    const newZoom = startZoom - (dy / 80);
    applyZoomAnchored(newZoom);
  }

  mapDiv.addEventListener('touchstart', (e) => {
    if (!e.touches || e.touches.length !== 1) return;

    const now = Date.now();
    const dt = now - lastTap;

    if (dt > 0 && dt < 350) {
      // Double tap detected
      e.preventDefault(); // prevents iOS smart zoom

      const touch = e.touches[0];
      anchorPx = clientToMapPixel(touch);
      anchorCoord = map.getCoordinateFromPixel(anchorPx);

      startY = touch.clientY;
      startZoom = map.getView().getZoom();
      movedDuringHold = false;
      isHoldZoom = true;

      // If the user does NOT drag, we'll treat it as "double tap to zoom in"
      // (we'll apply this on touchend if no significant movement happened)
      mapDiv.addEventListener('touchmove', moveHandler, { passive: false });
    } else {
      isHoldZoom = false;
      anchorPx = null;
      anchorCoord = null;
    }

    lastTap = now;
  }, { passive: false });

  mapDiv.addEventListener('touchend', () => {
    if (!isHoldZoom) return;

    // If it was a quick double tap with no drag, zoom in by 1 at the tapped location
    if (!movedDuringHold && anchorPx && anchorCoord) {
      const view = map.getView();
      const targetZoom = Math.min(view.getMaxZoom(), (view.getZoom() || 0) + 1);
      const targetCenter = centerForAnchorAtZoom(view, anchorCoord, anchorPx, targetZoom);

      view.animate({ center: targetCenter, zoom: targetZoom, duration: 180 });
    }

    isHoldZoom = false;
    mapDiv.removeEventListener('touchmove', moveHandler, { passive: false });
  }, { passive: true });
}
  
  // =====================
  // Roads
  // =====================
  function setRoadsLayerState() {
    if (!roadsLayer) return;
    roadsLayer.setVisible(roadsOn);
    const layers = map.getLayers();
    if (layers.getArray()[layers.getLength() - 1] !== roadsLayer) {
      map.removeLayer(roadsLayer);
      map.addLayer(roadsLayer);
    }
  }

  // =====================
  // Popups
  // =====================
  function fillDatePopup(popupEl, selectedCode, onPick) {
    popupEl.innerHTML = '';
    const reversed = serverOptions.slice().reverse();
    reversed.forEach((opt) => {
      const b = document.createElement('button');
      b.className = 'date-popup-item' + (opt.code === selectedCode ? ' selected' : '');
      b.textContent = showingDisney ? opt.label : (opt.esri_label || opt.label);
      b.onclick = function () { onPick(opt.code); hidePopup(popupEl); };
      popupEl.appendChild(b);
    });
  }

  function positionPopupForButton(popupEl, btnEl) {
    const r = btnEl.getBoundingClientRect();
    const gap = 8;

    const prevDisplay = popupEl.style.display;
    const prevVisibility = popupEl.style.visibility;
    popupEl.style.display = 'block';
    popupEl.style.visibility = 'hidden';
    const width = popupEl.offsetWidth;
    popupEl.style.display = prevDisplay;
    popupEl.style.visibility = prevVisibility;

    const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width));
    const top = Math.max(8, r.bottom + gap);

    popupEl.style.left = left + 'px';
    popupEl.style.top = top + 'px';
  }

  function showPopup(popupEl) {
    popupEl.style.display = 'block';
    requestAnimationFrame(() => { popupEl.style.opacity = '1'; });
  }
  function hidePopup(popupEl) {
    popupEl.style.opacity = '0';
    setTimeout(() => { popupEl.style.display = 'none'; }, 180);
  }

  // =====================
  // Dates + modes
  // =====================
  function updateDateUI() {
    if (!compareMode) {
      currentDateDisplay.textContent = showingDisney
        ? getLabelForCode(currentCode)
        : (getEsriLabelForCode(currentCode) || (getLabelForCode(currentCode) + ' (Satellite)'));
    } else {
      const leftLabel = showingDisney ? getLabelForCode(leftCode) : (getEsriLabelForCode(leftCode) || getLabelForCode(leftCode));
      const rightLabel = showingDisney ? getLabelForCode(rightCode) : (getEsriLabelForCode(rightCode) || getLabelForCode(rightCode));
      currentDateDisplay.textContent = `${leftLabel}  vs  ${rightLabel}`;
    }

    currentDateDisplay.style.display = 'block';
    compareBtn.style.display = 'flex';
    highlightBtn.style.display = (showingDisney && compareMode) ? 'flex' : 'none';
    settingsBtn.style.display = (compareMode && highlightMode) ? 'flex' : 'none';

    leftDateBtn.style.display = compareMode ? 'flex' : 'none';
    quickSwitchBtn.style.display = (lastTwoDates[1] && !compareMode) ? 'flex' : 'none';

    toggleIconImg.src = showingDisney ? 'icons/satellite.svg' : 'icons/mouse.svg';
    toggleIconImg.alt = showingDisney ? 'Satellite' : 'Disney Map';

    swipeThumb.style.display = (compareMode && !highlightMode) ? 'block' : 'none';
    swipeHandle.style.display = (compareMode && !highlightMode) ? 'block' : 'none';
    sensitivityRow.style.display = (compareMode && highlightMode && showSensitivity) ? 'block' : 'none';

    compareBtn.classList.toggle('active-btn', compareMode);
    highlightBtn.classList.toggle('active-btn', compareMode && showingDisney && highlightMode);
    settingsBtn.classList.toggle('active-btn', compareMode && highlightMode && showSensitivity);

    updateSwipeUI();
  }

  function setSingleDate(newCode) {
    if (currentCode === newCode) return;
    if (lastTwoDates[0] !== newCode) lastTwoDates = [newCode, lastTwoDates[0]];
    currentCode = newCode;

    const visD = disneyLayer.getVisible();
    map.removeLayer(disneyLayer);
    disneyLayer = makeDisneyLayer(newCode);
    disneyLayer.setVisible(visD);
    disneyLayer.getSource().set('extent', disneyWorldExtent);
    map.getLayers().setAt(0, disneyLayer);

    const esriId = getEsriIdForCode(newCode);
    const visE = esriLayer && esriLayer.getVisible();
    if (!esriLayer || esriLayer.get('esri_id') !== esriId) {
      if (esriLayer) map.removeLayer(esriLayer);
      esriLayer = makeEsriLayer(esriId);
      if (esriLayer) {
        esriLayer.set('esri_id', esriId);
        esriLayer.getSource().set('extent', disneyWorldExtent);
        map.getLayers().setAt(1, esriLayer);
      }
    }
    if (esriLayer) esriLayer.setVisible(visE);

    setRoadsLayerState();

    if (compareMode) {
      if (highlightMode) launchHighlightMode();
      else launchSwipeMode();
    }

    updateDateUI();
  }

  function clearCompareLayers() {
    if (leftLayer) { map.removeLayer(leftLayer); leftLayer = null; }
    if (rightLayer) { map.removeLayer(rightLayer); rightLayer = null; }
    if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }
  }

  function launchSwipeMode() {
    clearCompareLayers();

    if (showingDisney) {
      leftLayer = makeDisneyLayer(leftCode);
      rightLayer = makeDisneyLayer(rightCode);
    } else {
      const leftEsri = getEsriIdForCode(leftCode);
      const rightEsri = getEsriIdForCode(rightCode);
      leftLayer = makeEsriLayer(leftEsri);
      rightLayer = makeEsriLayer(rightEsri);
      if (!leftLayer || !rightLayer) {
        compareMode = false;
        updateDateUI();
        return;
      }
      leftLayer.setVisible(true);
      rightLayer.setVisible(true);
    }

    map.addLayer(leftLayer);
    map.addLayer(rightLayer);

    rightLayer.on('prerender', function (event) {
      const ctx = event.context;
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      const swipeX = Math.round(w * swipeRatio);
      ctx.save();
      ctx.beginPath();
      ctx.rect(swipeX, 0, w - swipeX, h);
      ctx.clip();
    });
    rightLayer.on('postrender', function (event) { event.context.restore(); });

    map.render();
    updateSwipeUI();
    requestAnimationFrame(updateSwipeUI);
    updateDateUI();
  }

  function launchHighlightMode() {
    clearCompareLayers();
    highlightLayer = makeHighlightLayer(leftCode, rightCode);
    map.addLayer(highlightLayer);
    updateDateUI();
  }

  // =====================
  // Swipe UI
  // =====================
  function updateSwipeUI() {
    if (!compareMode || highlightMode || !map) return;

    const mapEl = map.getTargetElement();
    const mapRect = mapEl.getBoundingClientRect();
    const w = mapRect.width;
    const h = mapRect.height;
    const x = Math.round(w * swipeRatio);

    const lineHalf = (swipeThumb.offsetWidth || 5) / 2;
    swipeThumb.style.left = (mapRect.left + x - lineHalf) + 'px';
    swipeThumb.style.top = mapRect.top + 'px';
    swipeThumb.style.height = h + 'px';

    const handleW = swipeHandle.offsetWidth || 34;
    const handleH = swipeHandle.offsetHeight || 34;
    let handlePos = 0.90;
    if (window.innerWidth <= 600) handlePos = 0.75;

    swipeHandle.style.left = (mapRect.left + x - (handleW / 2)) + 'px';
    swipeHandle.style.top = (mapRect.top + Math.round(h * handlePos) - (handleH / 2)) + 'px';
  }

  function startSwipeDrag(e) {
    e.preventDefault();
    document.body.style.userSelect = 'none';

    const move = (ev) => {
      const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const rect = map.getTargetElement().getBoundingClientRect();
      swipeRatio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));

      updateSwipeUI();
      if (rightLayer) rightLayer.changed();
      map.render();
    };

    const stop = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', stop);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', stop);
      document.body.style.userSelect = '';

      updateSwipeUI();
      if (rightLayer) rightLayer.changed();
      map.render();
    };

    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', stop);
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', stop);
  }

  swipeThumb.addEventListener('mousedown', startSwipeDrag);
  swipeThumb.addEventListener('touchstart', startSwipeDrag, { passive: false });
  swipeHandle.addEventListener('mousedown', startSwipeDrag);
  swipeHandle.addEventListener('touchstart', startSwipeDrag, { passive: false });

  // =====================
  // Buttons wiring
  // =====================
  dateBtn.addEventListener('click', () => {
    if (datePopup.style.display === 'block') { hidePopup(datePopup); return; }

    if (!compareMode) {
      fillDatePopup(datePopup, currentCode, setSingleDate);
    } else {
      fillDatePopup(datePopup, rightCode, (code) => {
        rightCode = code;
        (highlightMode ? launchHighlightMode : launchSwipeMode)();
        updateDateUI();
      });
    }

    positionPopupForButton(datePopup, dateBtn);
    showPopup(datePopup);

    const close = (e) => {
      if (!datePopup.contains(e.target) && e.target !== dateBtn && !dateBtn.contains(e.target)) {
        hidePopup(datePopup);
        document.removeEventListener('mousedown', close, true);
        document.removeEventListener('touchstart', close, true);
      }
    };
    setTimeout(() => {
      document.addEventListener('mousedown', close, true);
      document.addEventListener('touchstart', close, true);
    }, 0);
  });

  leftDateBtn.addEventListener('click', () => {
    if (!compareMode) return;
    if (leftDatePopup.style.display === 'block') { hidePopup(leftDatePopup); return; }

    fillDatePopup(leftDatePopup, leftCode, (code) => {
      leftCode = code;
      (highlightMode ? launchHighlightMode : launchSwipeMode)();
      updateDateUI();
    });

    positionPopupForButton(leftDatePopup, leftDateBtn);
    showPopup(leftDatePopup);

    const close = (e) => {
      if (!leftDatePopup.contains(e.target) && e.target !== leftDateBtn && !leftDateBtn.contains(e.target)) {
        hidePopup(leftDatePopup);
        document.removeEventListener('mousedown', close, true);
        document.removeEventListener('touchstart', close, true);
      }
    };
    setTimeout(() => {
      document.addEventListener('mousedown', close, true);
      document.addEventListener('touchstart', close, true);
    }, 0);
  });

  toggleBtn.addEventListener('click', () => {
    showingDisney = !showingDisney;

    if (!compareMode) {
      if (showingDisney) {
        disneyLayer.setVisible(true);
        if (esriLayer) esriLayer.setVisible(false);
      } else {
        disneyLayer.setVisible(false);
        const esriId = getEsriIdForCode(currentCode);
        if (!esriLayer || esriLayer.get('esri_id') !== esriId) {
          if (esriLayer) map.removeLayer(esriLayer);
          esriLayer = makeEsriLayer(esriId);
          if (esriLayer) {
            esriLayer.set('esri_id', esriId);
            esriLayer.getSource().set('extent', disneyWorldExtent);
            map.getLayers().setAt(1, esriLayer);
          }
        }
        if (esriLayer) esriLayer.setVisible(true);
      }
    } else {
      if (!showingDisney && highlightMode) { highlightMode = false; showSensitivity = false; }
      (highlightMode ? launchHighlightMode : launchSwipeMode)();
    }

    setRoadsLayerState();
    updateDateUI();
  });

  compareBtn.addEventListener('click', () => {
    compareMode = !compareMode;

    if (compareMode) {
      rightCode = currentCode;
      leftCode = getPreviousCode(currentCode);
      highlightMode = false;
      showSensitivity = false;
      leftDateBtn.style.display = 'flex';
      launchSwipeMode();
    } else {
      highlightMode = false;
      showSensitivity = false;
      clearCompareLayers();
      swipeThumb.style.display = 'none';
      swipeHandle.style.display = 'none';
      sensitivityRow.style.display = 'none';
      leftDateBtn.style.display = 'none';
    }

    updateDateUI();
  });

  highlightBtn.addEventListener('click', () => {
    if (!compareMode || !showingDisney) return;
    highlightMode = !highlightMode;
    showSensitivity = false;
    if (highlightMode) launchHighlightMode();
    else launchSwipeMode();
    updateDateUI();
  });

  settingsBtn.addEventListener('click', () => {
    if (!(compareMode && highlightMode)) return;
    showSensitivity = !showSensitivity;
    updateDateUI();
  });

  roadsBtn.addEventListener('click', () => {
    roadsOn = !roadsOn;
    roadsIconImg.src = roadsOn ? 'icons/no_roads.svg' : 'icons/roads.svg';
    roadsIconImg.alt = roadsOn ? 'No Roads' : 'Roads';
    setRoadsLayerState();
  });

  quickSwitchBtn.addEventListener('click', () => {
    if (lastTwoDates[1]) setSingleDate(lastTwoDates[1]);
  });

  // Find Me
  const findmeMessage = document.getElementById('findme-message');
  function showFindMeMessage(msg) {
    findmeMessage.textContent = msg;
    findmeMessage.style.display = 'block';
    setTimeout(() => { findmeMessage.style.opacity = '1'; }, 10);
    setTimeout(() => {
      findmeMessage.style.opacity = '0';
      setTimeout(() => { findmeMessage.style.display = 'none'; }, 400);
    }, 2200);
  }

  findmeBtn.addEventListener('click', () => {
    if (!navigator.geolocation) { showFindMeMessage('Geolocation not supported'); return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      const coords = [pos.coords.longitude, pos.coords.latitude];
      const projected = ol.proj.fromLonLat(coords);
      const within = ol.extent.containsCoordinate(disneyWorldExtent, projected);
      if (!within) { showFindMeMessage('Outside of WDW'); return; }

      const feature = new ol.Feature({ geometry: new ol.geom.Point(projected) });
      const layer = new ol.layer.Vector({
        source: new ol.source.Vector({ features: [feature] }),
        style: new ol.style.Style({
          image: new ol.style.Circle({
            radius: 10,
            fill: new ol.style.Fill({ color: 'rgba(0,116,217,0.35)' }),
            stroke: new ol.style.Stroke({ color: '#0074d9', width: 3 })
          })
        }),
        zIndex: 99
      });

      map.addLayer(layer);
      map.getView().animate({ center: projected, zoom: 17, duration: 800 });
      setTimeout(() => map.removeLayer(layer), 5000);
    }, () => showFindMeMessage('Unable to get location'), { enableHighAccuracy: true });
  });

  // Slider
  sensitivitySlider.addEventListener('input', () => {
    currentThreshold = sliderToThreshold(parseInt(sensitivitySlider.value, 10));
    if (compareMode && highlightMode) launchHighlightMode();
  });

  // Zoom buttons
  zoomInBtn.addEventListener('click', () => {
    const v = map.getView();
    v.animate({ zoom: v.getZoom() + 1, duration: 160 });
  });
  zoomOutBtn.addEventListener('click', () => {
    const v = map.getView();
    v.animate({ zoom: v.getZoom() - 1, duration: 160 });
  });

  // Info overlay
  infoIcon.addEventListener('click', () => { infoOverlay.style.display = 'block'; });
  infoClose.addEventListener('click', () => { infoOverlay.style.display = 'none'; });
  infoOverlay.addEventListener('click', (e) => { if (e.target === infoOverlay) infoOverlay.style.display = 'none'; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && infoOverlay.style.display === 'block') infoOverlay.style.display = 'none';
  });

  // =====================
  // Boot
  // =====================
  fetch('servers2.json')
    .then((r) => r.json())
    .then((json) => {
      serverOptions = json;
      currentCode = serverOptions[serverOptions.length - 1].code;
      lastTwoDates = [currentCode, null];

      initMap();
      enableDoubleTapHoldZoom();
      updateDateUI();

      // Expose bridge
      window.WDWMX.ol = ol;
      window.WDWMX.getMap = () => map;
      window.WDWMX.getCurrentCode = () => currentCode;
      window.WDWMX.getRightCode = () => rightCode;
      window.WDWMX.getCompareMode = () => compareMode;
      window.WDWMX.getLabelForCode = (code) => getLabelForCode(code);
      window.WDWMX.setSingleDate = (code) => setSingleDate(code);
    })
    .catch((err) => {
      alert('Failed to load servers2.json: ' + err);
    });
})();
