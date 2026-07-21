/* global ol */
(function () {
  'use strict';

  // Expose a bridge for app.js (reporting UI)
  window.WDWMX = window.WDWMX || {};

  // =====================
  // Core config
  // =====================

  const ESRI_TILE_URL = (esriId) =>
    `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${esriId}/{z}/{y}/{x}`;

  const ROADS_TILE_URL = 'https://mt1.google.com/vt/lyrs=h&x={x}&y={y}&z={z}';

  // =====================
  // Park Configurations
  // Loaded from parks/{parkId}/{parkId}_config.json, with location data
  // (locations + locationGroups) from parks/{parkId}/{parkId}_locations.json
  // =====================
  let PARKS = {};
  const PARK_IDS = ['wdw', 'dlp', 'dlr', 'hkdl', 'shdr', 'tdr'];

  // Load all park configs (and their location files) from JSON
  async function loadParkConfigs() {
    const configs = await Promise.all(
      PARK_IDS.map(async (parkId) => {
        try {
          const [cfgRes, locRes] = await Promise.all([
            fetch(`parks/${parkId}/${parkId}_config.json`),
            fetch(`parks/${parkId}/${parkId}_locations.json`)
          ]);
          if (!cfgRes.ok) return null;
          const config = await cfgRes.json();

          // Merge the locations file in; a config carrying its own
          // locations/locationGroups still works as a fallback
          if (locRes.ok) {
            try {
              const locData = await locRes.json();
              if (Array.isArray(locData.locations)) config.locations = locData.locations;
              if (Array.isArray(locData.locationGroups)) config.locationGroups = locData.locationGroups;
            } catch (e) {
              console.warn(`Failed to parse ${parkId} locations:`, e);
            }
          }
          return config;
        } catch (e) {
          console.warn(`Failed to load ${parkId} config:`, e);
        }
        return null;
      })
    );

    configs.forEach((config) => {
      if (config && config.parkId) {
        PARKS[config.parkId] = config;
      }
    });

    // Set TDR_CONFIG from loaded TDR park config
    if (PARKS.tdr) {
      TDR_CONFIG = PARKS.tdr;
      window.WDWMX.TDR_CONFIG = TDR_CONFIG;
    }
  }

  // =====================
  // Tokyo Disney Resort Configuration
  // Loaded from parks/tdr/tdr_config.json (update that file when cookies expire)
  // =====================
  let TDR_CONFIG = {
    tileBaseUrl: '',
    userAgent: '',
    cookies: {},
    proxyUrl: '',
    cookieExpires: ''
  };

  // TDR state: 'daytime' or 'nighttime'
  let tdrTimeMode = 'daytime';
  // TDR rotation: 0, 90, 180, or 270 degrees
  let tdrRotation = 0;

  // Expose TDR config for the proxy worker
  window.WDWMX.TDR_CONFIG = TDR_CONFIG;

  // =====================
  // Park configuration
  // =====================
  // tileTemplate supports {code} (optional) and {z}/{x}/{y}
  // yScheme: 'xyz' (standard) or 'tms' (server expects flipped Y)

  // Park-specific quick-access locations are loaded from separate files
  // (parks/{parkId}/{parkId}_locations.json): "locations" + "locationGroups"

  // A location "width" (degrees of longitude) as a true on-screen square in
  // projected meters, centered on lon/lat. Fitting this square means the
  // whole region stays visible on any device: landscape shows excess tiles
  // left/right, portrait shows excess top/bottom.
  const METERS_PER_DEGREE = 111319.49079327358; // EPSG:3857 meters per degree of longitude

  function squareExtent3857(lon, lat, width) {
    const c = ol.proj.fromLonLat([lon, lat]);
    const half = (width * METERS_PER_DEGREE) / 2;
    return [c[0] - half, c[1] - half, c[0] + half, c[1] + half];
  }

  // Current park (default to WDW for now; UI switch can be added later)
  let currentParkId = 'wdw';

  // Park selection: URL param takes precedence, then localStorage, then default
  try {
    const urlPid = new URLSearchParams(window.location.search).get('park');
    const storedPid = localStorage.getItem('wdwmx:parkId');
    const candidate = (urlPid || storedPid || 'wdw').toLowerCase();
    if (PARK_IDS.includes(candidate)) currentParkId = candidate;
  } catch (e) {
    // ignore
  }


  function getCurrentPark() {
    return PARKS[currentParkId] || PARKS.wdw;
  }

  function getServersUrl(parkId) {
    const pid = parkId || currentParkId || 'wdw';
    return `parks/${pid}/${pid}_dis_servers.json`;
  }
  function getSatServersUrl(parkId) {
    const pid = parkId || currentParkId || 'wdw';
    return `parks/${pid}/${pid}_sat_servers.json`;
  }

  // Convert XYZ tile coords to lon/lat at the tile's NW corner.
  function tileXYZToLonLat(x, y, z) {
    const n = Math.pow(2, z);
    const lon = (x / n) * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
    const lat = (latRad * 180) / Math.PI;
    return [lon, lat];
  }

  // Build a tight EPSG:3857 extent from tile bounds (using highest available zoom).
  // For TMS servers, bounds are in server Y, so we convert them to XYZ for calculations.
  function extentFromTileBounds(park) {
    if (!park || !park.boundsByZoom) return null;

    const zoomKeys = Object.keys(park.boundsByZoom)
      .map((k) => parseInt(k, 10))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a);

    if (!zoomKeys.length) return null;

    const z = zoomKeys[0];
    const b = park.boundsByZoom[String(z)];
    if (!b) return null;

    const n = Math.pow(2, z);

    const minX = b.minX;
    const maxX = b.maxX;

    let minYxyz = b.minY;
    let maxYxyz = b.maxY;

    if (park.yScheme === 'tms') {
      minYxyz = (n - 1) - b.maxY;
      maxYxyz = (n - 1) - b.minY;
    }

    const nw = tileXYZToLonLat(minX, minYxyz, z);
    const ne = tileXYZToLonLat(maxX + 1, minYxyz, z);
    const sw = tileXYZToLonLat(minX, maxYxyz + 1, z);
    const se = tileXYZToLonLat(maxX + 1, maxYxyz + 1, z);

    const p1 = ol.proj.fromLonLat(nw);
    const p2 = ol.proj.fromLonLat(ne);
    const p3 = ol.proj.fromLonLat(sw);
    const p4 = ol.proj.fromLonLat(se);

    const xs = [p1[0], p2[0], p3[0], p4[0]];
    const ys = [p1[1], p2[1], p3[1], p4[1]];

    const minE = [Math.min(...xs), Math.min(...ys)];
    const maxE = [Math.max(...xs), Math.max(...ys)];

    // Small padding so panning doesn't feel like it hits a hard wall
    const padX = (maxE[0] - minE[0]) * 0.02;
    const padY = (maxE[1] - minE[1]) * 0.02;

    return [minE[0] - padX, minE[1] - padY, maxE[0] + padX, maxE[1] + padY];
  }



  // =====================
  // App State
  // =====================
  let serverOptions = [];
  let satOptions = [];       // Separate satellite (ESRI Wayback) version list
  let currentSatEsriId = ''; // Currently shown satellite version
  let currentCode = null;
  let leftCode = null;
  let rightCode = null;
  let leftSatEsriId = '';    // Compare mode: left satellite version
  let rightSatEsriId = '';   // Compare mode: right satellite version
  let lastTwoDates = [null, null];

  // Persist the last chosen LEFT compare date per-park
  let lastLeftCodeByPark = {}; // { [parkId]: code }


  // Persist the last VIEWED (previously selected) map version per-park
  let lastViewedCodeByPark = {}; // { [parkId]: code }

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
  const daynightBtn = document.getElementById('daynight-btn');
  const daynightIconImg = document.getElementById('daynight-icon-img');
  const rotateBtn = document.getElementById('rotate-btn');
  const datePrevBtn = document.getElementById('date-prev-btn');
  const dateNextBtn = document.getElementById('date-next-btn');
  const dateNavRow = document.getElementById('date-nav-row');
  const singleDateLabel = document.getElementById('single-date-label');
  const leftDateLabel = document.getElementById('left-date-label');
  const rightDateLabel = document.getElementById('right-date-label');
  // Extent (dynamic per park)
  let parkExtent = null;

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

  // Month name to number (0-indexed)
  const MONTH_MAP = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
  };

  // Parse a date label into a comparable timestamp (memoized - labels are
  // parsed repeatedly during date navigation and satellite matching).
  // Handles formats: "20 Feb 2014", "Aug 2018", "Early Mar 2020", "Late Dec 2019", "Dec 2019 (Mid)"
  const dateLabelCache = new Map();
  function parseDateLabel(label) {
    if (!label) return 0;
    const cached = dateLabelCache.get(label);
    if (cached !== undefined) return cached;
    const t = parseDateLabelUncached(label);
    dateLabelCache.set(label, t);
    return t;
  }

  function parseDateLabelUncached(label) {
    const s = label.toLowerCase().replace(/[()]/g, '');

    // Try exact date: "20 Feb 2014" or "02 Nov 2018"
    const exactMatch = s.match(/^(\d{1,2})\s+([a-z]{3})\s+(\d{4})$/);
    if (exactMatch) {
      const day = parseInt(exactMatch[1], 10);
      const mon = MONTH_MAP[exactMatch[2]];
      const year = parseInt(exactMatch[3], 10);
      if (mon !== undefined) return new Date(year, mon, day).getTime();
    }

    // Try "Early/Late/Mid Mon YYYY" or "Mon YYYY Early/Late/Mid"
    const modMatch = s.match(/^(early|late|mid)?\s*([a-z]{3})\s+(\d{4})\s*(early|late|mid)?$/);
    if (modMatch) {
      const mod = modMatch[1] || modMatch[4] || '';
      const mon = MONTH_MAP[modMatch[2]];
      const year = parseInt(modMatch[3], 10);
      if (mon !== undefined) {
        let day = 1;
        if (mod === 'early') day = 5;
        else if (mod === 'mid') day = 15;
        else if (mod === 'late') day = 25;
        else day = 1; // plain month defaults to 1st
        return new Date(year, mon, day).getTime();
      }
    }

    return 0; // unparseable
  }

  // Find the closest satellite version for a Disney date label.
  // Returns the esri_id of the satellite with date <= Disney date, or the oldest if none.
  function findClosestSatellite(disneyLabel) {
    if (!satOptions.length) return '';
    const disneyTime = parseDateLabel(disneyLabel);
    if (!disneyTime) {
      // Can't parse, return newest satellite
      return satOptions[satOptions.length - 1].esri_id;
    }

    // Find the latest satellite that's <= Disney date
    let best = null;
    let bestTime = 0;
    for (const sat of satOptions) {
      const satTime = parseDateLabel(sat.label);
      if (satTime && satTime <= disneyTime && satTime > bestTime) {
        best = sat;
        bestTime = satTime;
      }
    }

    // If no satellite is older than Disney date, use the oldest satellite
    return best ? best.esri_id : satOptions[0].esri_id;
  }

  function getPreviousCode(code) {
    const i = serverOptions.findIndex((o) => o.code === code);
    return i > 0 ? serverOptions[i - 1].code : serverOptions[0].code;
  }

  function isValidCode(code) {
    return !!code && serverOptions.some((o) => o.code === code);
  }

  // Returns the navigation list: Disney dates or satellite versions.
  function getNavOptions() {
    return showingDisney ? serverOptions : satOptions;
  }

  // Find a position in the nav list.
  // In Disney mode, matches by code. In satellite mode, matches by esri_id.
  function findNavIndex(codeOrEsriId, navOpts) {
    if (showingDisney) {
      return navOpts.findIndex(o => o.code === codeOrEsriId);
    }
    return navOpts.findIndex(o => o.esri_id === codeOrEsriId);
  }

  // Get the active satellite esri_id (or find closest match for current Disney date)
  function getCurrentSatId() {
    return currentSatEsriId || findClosestSatellite(getLabelForCode(currentCode));
  }

  function getParkStorageKey(suffix) {
    return `wdwmx_${suffix}_${currentParkId || 'wdw'}`;
  }

  function loadLastLeftCode() {
    // Load from memory first, then localStorage (if available)
    const pid = currentParkId || 'wdw';
    if (lastLeftCodeByPark[pid]) return lastLeftCodeByPark[pid];
    try {
      const v = localStorage.getItem(getParkStorageKey('lastLeftCode'));
      if (v) {
        lastLeftCodeByPark[pid] = v;
        return v;
      }
    } catch {}
    return null;
  }

  function saveLastLeftCode(code) {
    const pid = currentParkId || 'wdw';
    lastLeftCodeByPark[pid] = code;
    try { localStorage.setItem(getParkStorageKey('lastLeftCode'), code); } catch {}
  }


  function loadLastViewedCode() {
    const pid = currentParkId || 'wdw';
    if (lastViewedCodeByPark[pid]) return lastViewedCodeByPark[pid];
    try {
      const v = localStorage.getItem(getParkStorageKey('lastViewedCode'));
      if (v) {
        lastViewedCodeByPark[pid] = v;
        return v;
      }
    } catch {}
    return null;
  }

  function saveLastViewedCode(code) {
    const pid = currentParkId || 'wdw';
    lastViewedCodeByPark[pid] = code;
    try { localStorage.setItem(getParkStorageKey('lastViewedCode'), code); } catch {}
  }

  function chooseLeftCodeForCompare(current) {
    // Prefer the last VIEWED map version (like the old Switch Mode behaviour)
    const remembered = loadLastViewedCode();
    if (isValidCode(remembered) && remembered !== current) return remembered;

    // If there is no previous viewed date (first run), fall back to previous
    const prev = getPreviousCode(current);
    return prev === current ? current : prev;
  }

  // =====================
  // Layers
  // =====================
  function makeDisneySource(code) {
    const park = getCurrentPark();
    const server = serverOptions.find(o => o.code === code);
    const tpl = (server && server.url) ? server.url : String(park.tileTemplate || '');
    const isTdr = (park.parkId === 'tdr');

    return new ol.source.XYZ({
      minZoom: park.minZoom,
      maxZoom: park.maxZoom,
      tileUrlFunction: function (tileCoord) {
        if (!tileCoord) return '';
        const z = tileCoord[0];
        const x = tileCoord[1];
        const y = tileCoord[2];

        const n = Math.pow(2, z);
        const yy = (park.yScheme === 'tms') ? ((n - 1) - y) : y;

        if (isTdr) {
          // Pass the active TDR server ID (from tdr_dis_servers.json) so the
          // proxy builds the right tile URL; it changes over time and is
          // updated by editing that file, no code/worker change needed
          let url = TDR_CONFIG.proxyUrl + `z${z}/${x}_${yy}.jpg?mode=${tdrTimeMode}`;
          if (currentCode) url += `&sid=${encodeURIComponent(currentCode)}`;
          return url;
        }

        let url = tpl;
        if (url.indexOf('{code}') >= 0) url = url.replace('{code}', String(code));
        url = url.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(yy));
        return url;
      }
    });
  }

  function makeDisneyLayer(code) {
    return new ol.layer.Tile({
      source: makeDisneySource(code),
      visible: true
    });
  }

  function makeEsriLayer(esriId) {
    if (!esriId) return null;

    // SHDR uses Baidu coordinates - need to transform to real WGS84 for satellite
    if (currentParkId === 'shdr') {
      return makeEsriLayerSHDR(esriId);
    }

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

  // Special ESRI layer for SHDR that transforms Baidu coords to real WGS84
  function makeEsriLayerSHDR(esriId) {
    const park = PARKS.shdr;
    const fakeCenter = park.defaultCenter; // Baidu-based "fake" coords
    const realCenter = park.realCenter;    // Actual WGS84 coords

    // Calculate the offset in Web Mercator (EPSG:3857)
    const fakeProj = ol.proj.fromLonLat(fakeCenter);
    const realProj = ol.proj.fromLonLat(realCenter);
    const offsetX = realProj[0] - fakeProj[0];
    const offsetY = realProj[1] - fakeProj[1];

    const lyr = new ol.layer.Tile({
      source: new ol.source.XYZ({
        tileUrlFunction: function(tileCoord) {
          const z = tileCoord[0];
          const x = tileCoord[1];
          const y = tileCoord[2];

          // Calculate tile center in fake projection
          const tileSize = 256;
          const resolution = (2 * Math.PI * 6378137) / (tileSize * Math.pow(2, z));
          const originX = -20037508.342789244;
          const originY = 20037508.342789244;

          // Center of this tile in fake EPSG:3857
          const fakeTileCenterX = originX + (x + 0.5) * tileSize * resolution;
          const fakeTileCenterY = originY - (y + 0.5) * tileSize * resolution;

          // Apply offset to get real EPSG:3857 coordinates
          const realTileCenterX = fakeTileCenterX + offsetX;
          const realTileCenterY = fakeTileCenterY + offsetY;

          // Calculate which real tile this corresponds to
          const realX = Math.floor((realTileCenterX - originX) / (tileSize * resolution));
          const realY = Math.floor((originY - realTileCenterY) / (tileSize * resolution));

          // Build ESRI URL with real tile coordinates
          return `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${esriId}/${z}/${realY}/${realX}`;
        },
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
  // Precomputed sRGB (0-255) -> linear lookup table, avoids Math.pow per channel
  const SRGB_LINEAR = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    SRGB_LINEAR[i] = c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
  }

  function labF(t) {
    return t > 0.008856 ? Math.cbrt(t) : (7.787 * t) + 16 / 116;
  }

  // Allocation-free CIE76 deltaE between two RGB pixels.
  // Equivalent to converting both to Lab and taking the euclidean distance,
  // but with no per-pixel array allocations (hot path: 65k pixels per tile).
  function deltaERgb(r1, g1, b1, r2, g2, b2) {
    let r = SRGB_LINEAR[r1], g = SRGB_LINEAR[g1], b = SRGB_LINEAR[b1];
    const fx1 = labF((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
    const fy1 = labF(r * 0.2126 + g * 0.7152 + b * 0.0722);
    const fz1 = labF((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);

    r = SRGB_LINEAR[r2]; g = SRGB_LINEAR[g2]; b = SRGB_LINEAR[b2];
    const fx2 = labF((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
    const fy2 = labF(r * 0.2126 + g * 0.7152 + b * 0.0722);
    const fz2 = labF((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);

    const dL = 116 * (fy1 - fy2);
    const da = 500 * ((fx1 - fy1) - (fx2 - fy2));
    const db = 200 * ((fy1 - fz1) - (fy2 - fz2));
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  function makeHighlightLayer(baseCode, compareCode) {
    const park = getCurrentPark();
    // Check if servers have custom URLs
    const baseServer = serverOptions.find(o => o.code === baseCode);
    const compareServer = serverOptions.find(o => o.code === compareCode);
    const baseTpl = (baseServer && baseServer.url) ? baseServer.url : String(park.tileTemplate || '');
    const compareTpl = (compareServer && compareServer.url) ? compareServer.url : String(park.tileTemplate || '');

    const baseUrlTpl = (baseTpl.indexOf('{code}') >= 0)
      ? baseTpl.replace('{code}', String(baseCode))
      : baseTpl;
    const compareUrlTpl = (compareTpl.indexOf('{code}') >= 0)
      ? compareTpl.replace('{code}', String(compareCode))
      : compareTpl;

    return new ol.layer.Tile({
      source: new ol.source.XYZ({
        maxZoom: 20,
        tileUrlFunction: function(tileCoord) {
          // Return a dummy URL - actual loading is done in tileLoadFunction
          return 'data:,';
        },
        tileLoadFunction: function (tile, src) {
          const zxy = tile.tileCoord;
          const z = zxy[0];
          const x = zxy[1];
          const y = (park.yScheme === 'tms') ? ((Math.pow(2, z) - 1) - zxy[2]) : zxy[2];

          // Build both URLs with proper TMS handling
          const baseUrl = baseUrlTpl
            .replace('{z}', z)
            .replace('{x}', x)
            .replace('{y}', String(y));
          const compareUrl = compareUrlTpl
            .replace('{z}', z)
            .replace('{x}', x)
            .replace('{y}', String(y));

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

                if (deltaERgb(r1, g1, b1, r2, g2, b2) > threshold) {
                  out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 0; out.data[i + 3] = 200;
                } else {
                  const gray = 0.3 * r1 + 0.59 * g1 + 0.11 * b1;
                  out.data[i] = out.data[i + 1] = out.data[i + 2] = gray;
                  out.data[i + 3] = a1;
                }
              }

              ctx.putImageData(out, 0, 0);
              canvas.toBlob(function(blob) {
                if (blob) {
                  const url = URL.createObjectURL(blob);
                  const tileImg = tile.getImage();
                  tileImg.onload = function() { URL.revokeObjectURL(url); };
                  tileImg.src = url;
                } else {
                  tile.getImage().src = canvas.toDataURL();
                }
              }, 'image/png');
            };

            cmpImg.onerror = function () { tile.getImage().src = baseImg.src; };
            cmpImg.src = compareUrl;
          };

          baseImg.onerror = function () {
            const blank = document.createElement('canvas');
            blank.width = blank.height = 256;
            blank.toBlob(function(blob) {
              if (blob) {
                const url = URL.createObjectURL(blob);
                const tileImg = tile.getImage();
                tileImg.onload = function() { URL.revokeObjectURL(url); };
                tileImg.src = url;
              }
            }, 'image/png');
          };

          baseImg.src = baseUrl;
        }
      })
    });
  }

  // =====================
  // Map init
  // =====================
  function initMap() {
    disneyLayer = makeDisneyLayer(currentCode);
    esriLayer = makeEsriLayer(findClosestSatellite(getLabelForCode(currentCode)));
    roadsLayer = makeRoadsLayer();

    const park = getCurrentPark();
    parkExtent = extentFromTileBounds(park);

    if (parkExtent) {
      disneyLayer.getSource().set('extent', parkExtent);
      if (esriLayer) esriLayer.getSource().set('extent', parkExtent);
      roadsLayer.getSource().set('extent', parkExtent);
    }

    // Determine initial center and zoom - prefer park's defaultCenter/defaultZoom if set
    let initialCenter;
    let initialZoom;

    if (park.defaultCenter && park.defaultZoom) {
      initialCenter = ol.proj.fromLonLat(park.defaultCenter);
      initialZoom = park.defaultZoom;
    } else if (parkExtent) {
      initialCenter = ol.extent.getCenter(parkExtent);
      initialZoom = park.minZoom + 2;
    } else {
      initialCenter = ol.proj.fromLonLat([-81.566575, 28.386606]);
      initialZoom = park.minZoom + 2;
    }

    // Set rotation for parks that have a default rotation
    const defaultRotation = park.defaultRotation || 0;
    const rotationRad = defaultRotation * (Math.PI / 180);

    map = new ol.Map({
      target: 'map',
      layers: [disneyLayer, esriLayer, roadsLayer].filter(Boolean),
      view: new ol.View({
        center: initialCenter,
        zoom: initialZoom,
        minZoom: park.minZoom,
        maxZoom: park.maxZoom,
        extent: parkExtent || undefined,
        constrainOnlyCenter: true,  // Allows zooming out while keeping center in bounds
        rotation: rotationRad
      }),
      controls: ol.control.defaults.defaults({ zoom: false, rotate: false }),
      interactions: ol.interaction.defaults.defaults({
        altShiftDragRotate: false,
        pinchRotate: false
      })
    });

    // Initialize rotation state
    if (defaultRotation) {
      tdrRotation = defaultRotation;
    }

    // If park has defaultWidth, fit to extent instead of using zoom
    if (park.defaultWidth && park.defaultCenter) {
      const extent3857 = squareExtent3857(park.defaultCenter[0], park.defaultCenter[1], park.defaultWidth);
      map.getView().fit(extent3857, { duration: 0 });
    }

    map.on('rendercomplete', updateSwipeUI);
    const ro = new ResizeObserver(updateSwipeUI);
    ro.observe(document.getElementById('map'));
    window.addEventListener('resize', updateSwipeUI);
    window.addEventListener('scroll', updateSwipeUI, { passive: true });

    // TDR: re-orient the map from the reference points continuously as the
    // view is panned (change:center fires throughout the drag/inertia), plus
    // a final settle on moveend and the initial rotation for the start view
    map.getView().on('change:center', scheduleTdrAutoRotation);
    map.on('moveend', applyTdrAutoRotation);
    applyTdrAutoRotation();

    // Dock quick pan - populate based on current park
    const dock = document.getElementById('location-dock');
    if (dock) {
      const locations = park.locations || [];

      // Clear and populate dock with park-specific locations from config
      dock.innerHTML = '';

      locations.forEach((loc) => {
        const btn = document.createElement('button');
        btn.dataset.coords = loc.coords.join(',');
        btn.dataset.width = String(loc.width);
        if (loc.rotation !== undefined) {
          btn.dataset.rotation = String(loc.rotation);
        }
        btn.title = loc.alt;

        const img = document.createElement('img');
        img.src = loc.icon;
        img.alt = loc.alt;
        img.onerror = function() { this.src = 'icons/locations/marker.svg'; };

        btn.appendChild(img);
        dock.appendChild(btn);
      });

      // Attach click handlers to all dock buttons
      dock.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          const [lonStr, latStr] = (btn.dataset.coords || '').split(',');
          const lon = parseFloat(lonStr);
          const lat = parseFloat(latStr);
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

          // Apply rotation if specified (for TDR locations)
          const rotationDeg = parseFloat(btn.dataset.rotation);
          const hasRotation = Number.isFinite(rotationDeg);
          if (hasRotation) {
            tdrRotation = rotationDeg;
          }

          // Use width-based extent fitting if available (adapts to screen size)
          const width = parseFloat(btn.dataset.width);
          if (Number.isFinite(width) && width > 0) {
            // Fit the projected view square for center + width
            const extent3857 = squareExtent3857(lon, lat, width);

            // Calculate zoom level to fit extent
            const view = map.getView();
            const size = map.getSize();
            const resolution = view.getResolutionForExtent(extent3857, size);
            const targetZoom = view.getZoomForResolution(resolution);
            const target = ol.proj.fromLonLat([lon, lat]);

            // Animate all properties at once (center, zoom, rotation)
            const animateOpts = { center: target, zoom: targetZoom, duration: 600 };
            if (hasRotation) {
              animateOpts.rotation = rotationDeg * (Math.PI / 180);
            }
            view.animate(animateOpts);
          } else {
            // Fallback to legacy zoom-based approach
            const target = ol.proj.fromLonLat([lon, lat]);
            const targetZoom = Number.isFinite(parseFloat(btn.dataset.zoom))
              ? parseFloat(btn.dataset.zoom)
              : 16;

            const animateOpts = { center: target, zoom: targetZoom, duration: 600 };
            if (hasRotation) {
              animateOpts.rotation = rotationDeg * (Math.PI / 180);
            }
            map.getView().animate(animateOpts);
          }
        });
      });
    }
  }

        // Double-tap then drag up/down to zoom (mobile helper)
      // Works even with browser zoom disabled, because it adjusts the OpenLayers view zoom directly.
      // Zooms centered on the finger position (like Google/Apple Maps).
      function enableDoubleTapHoldZoom() {
        const mapDiv = map.getTargetElement();
        if (!mapDiv) return;

        let lastTap = 0;
        let lastTapXY = null;
        let isHoldZoom = false;
        let didDrag = false;
        let startY = 0;
        let startZoom = 0;
        let zoomAnchor = null; // map coordinate where the finger tapped

        // Zoom keeping the anchor's geographic point fixed at its screen
        // position (the point under the finger stays under the finger),
        // instead of recentring the map on it.
        function zoomAboutAnchor(view, newZoom, anchor, duration) {
          const oldCenter = view.getCenter();
          const oldRes = view.getResolution();
          const newRes = view.getResolutionForZoom(newZoom);
          if (!oldCenter || !Number.isFinite(oldRes) || !Number.isFinite(newRes)) return;

          const ratio = newRes / oldRes;
          const newCenter = [
            anchor[0] - (anchor[0] - oldCenter[0]) * ratio,
            anchor[1] - (anchor[1] - oldCenter[1]) * ratio
          ];
          view.animate({ zoom: newZoom, center: newCenter, duration: duration });
        }

        function moveHandler(e) {
          if (!isHoldZoom || !e.touches || e.touches.length !== 1) return;
          e.preventDefault();
          didDrag = true;

          const dy = e.touches[0].clientY - startY;
          const view = map.getView();

          // Drag up = zoom in, drag down = zoom out
          let newZoom = startZoom - (dy / 80);
          newZoom = Math.max(view.getMinZoom(), Math.min(view.getMaxZoom(), newZoom));

          if (zoomAnchor) zoomAboutAnchor(view, newZoom, zoomAnchor, 0);
        }

        mapDiv.addEventListener('touchstart', (e) => {
          if (!e.touches || e.touches.length !== 1) return;

          const now = Date.now();
          const dt = now - lastTap;
          const tapX = e.touches[0].clientX;
          const tapY = e.touches[0].clientY;

          // Quick second tap enables hold-to-zoom
          if (dt > 0 && dt < 350 && lastTapXY) {
            e.preventDefault(); // prevents iOS smart zoom
            startY = tapY;
            startZoom = map.getView().getZoom();
            isHoldZoom = true;
            didDrag = false;

            // Resolve the pixel to a map coordinate for anchor
            // Calculate pixel relative to the map element, not the viewport
            const rect = mapDiv.getBoundingClientRect();
            const pixel = [tapX - rect.left, tapY - rect.top];
            zoomAnchor = map.getCoordinateFromPixel(pixel);

            mapDiv.addEventListener('touchmove', moveHandler, { passive: false });
          } else {
            isHoldZoom = false;
          }

          lastTap = now;
          lastTapXY = [tapX, tapY];
        }, { passive: false });

        mapDiv.addEventListener('touchend', () => {
          if (!isHoldZoom) return;

          // If user double-tapped without dragging, zoom in one level
          // anchored at the tap point (no recentring)
          if (!didDrag && zoomAnchor) {
            const view = map.getView();
            const newZoom = Math.min(view.getMaxZoom(), startZoom + 1);
            zoomAboutAnchor(view, newZoom, zoomAnchor, 250);
          }

          isHoldZoom = false;
          didDrag = false;
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
  // constraint: 'olderThan' filters to show only dates older than constraintCode
  //             'newerThan' filters to show only dates newer than constraintCode
  //             null/undefined shows all dates
  // selectedId: Disney code (showingDisney) or esri_id (satellite mode).
  // onPick receives: Disney code or esri_id depending on mode.
  function fillDatePopup(popupEl, selectedId, onPick, constraint, constraintId) {
    popupEl.innerHTML = '';
    const navOpts = getNavOptions();
    const reversed = navOpts.slice().reverse();

    // Get the constraint index for filtering (within navOpts)
    let constraintIdx = -1;
    if (constraint && constraintId) {
      constraintIdx = findNavIndex(constraintId, navOpts);
    }

    let selectedBtn = null;
    reversed.forEach((opt, i) => {
      // reversed[i] is navOpts[length - 1 - i] - avoids O(n^2) indexOf
      const optIdx = navOpts.length - 1 - i;

      // Apply constraint filter
      if (constraint === 'olderThan' && constraintIdx >= 0 && optIdx >= constraintIdx) {
        return;
      }
      if (constraint === 'newerThan' && constraintIdx >= 0 && optIdx <= constraintIdx) {
        return;
      }

      // Key for this item: code in Disney mode, esri_id in satellite mode
      const optKey = showingDisney ? opt.code : opt.esri_id;
      const isSelected = optKey === selectedId;

      const b = document.createElement('button');
      b.className = 'date-popup-item' + (isSelected ? ' selected' : '');
      b.textContent = opt.label;
      b.onclick = function () { onPick(optKey); hidePopup(popupEl); };
      popupEl.appendChild(b);
      if (isSelected) selectedBtn = b;
    });

    // Scroll the selected item into center of the popup after it's rendered
    if (selectedBtn) {
      setTimeout(() => {
        const itemTop = selectedBtn.offsetTop;
        const itemH = selectedBtn.offsetHeight;
        const popupH = popupEl.clientHeight;
        popupEl.scrollTop = itemTop - (popupH / 2) + (itemH / 2);
      }, 20);
    }
  }

  function positionPopup(popupEl, anchorEl, options) {
    const opts = options || {};
    const align = opts.align || 'right';
    const r = anchorEl.getBoundingClientRect();
    const gap = 8;

    const prevDisplay = popupEl.style.display;
    const prevVisibility = popupEl.style.visibility;
    popupEl.style.display = 'block';
    popupEl.style.visibility = 'hidden';
    const pw = popupEl.offsetWidth;
    popupEl.style.display = prevDisplay;
    popupEl.style.visibility = prevVisibility;

    let left;
    if (align === 'center') {
      left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.left + (r.width / 2) - (pw / 2)));
    } else {
      left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.right - pw));
    }

    popupEl.style.left = left + 'px';
    popupEl.style.top = Math.max(8, r.bottom + gap) + 'px';
  }

  function showPopup(popupEl) {
    // Cancel a pending hide so it can't close the popup we're opening
    if (popupEl._hideTimer) { clearTimeout(popupEl._hideTimer); popupEl._hideTimer = null; }
    popupEl.style.display = 'block';
    requestAnimationFrame(() => { popupEl.style.opacity = '1'; });
  }
  function hidePopup(popupEl) {
    popupEl.style.opacity = '0';
    if (popupEl._hideTimer) clearTimeout(popupEl._hideTimer);
    popupEl._hideTimer = setTimeout(() => {
      popupEl.style.display = 'none';
      popupEl._hideTimer = null;
    }, 180);
  }

  // =====================
  // Dates + modes
  // =====================
  function updateDateUI() {
    // Toggle compare-mode class on containers
    currentDateDisplay.classList.toggle('compare-mode', compareMode);
    dateNavRow.classList.toggle('compare-mode', compareMode);

    if (!compareMode) {
      if (showingDisney) {
        singleDateLabel.textContent = getLabelForCode(currentCode);
      } else {
        const sat = satOptions.find(o => o.esri_id === getCurrentSatId());
        singleDateLabel.textContent = sat ? sat.label : 'Satellite';
      }
    } else {
      if (showingDisney) {
        leftDateLabel.textContent = getLabelForCode(leftCode);
        rightDateLabel.textContent = getLabelForCode(rightCode);
      } else {
        const satL = satOptions.find(o => o.esri_id === leftSatEsriId);
        const satR = satOptions.find(o => o.esri_id === rightSatEsriId);
        leftDateLabel.textContent = satL ? satL.label : 'Satellite';
        rightDateLabel.textContent = satR ? satR.label : 'Satellite';
      }
    }

    currentDateDisplay.style.display = 'block';
    compareBtn.style.display = 'flex';
    highlightBtn.style.display = (showingDisney && compareMode) ? 'flex' : 'none';
    settingsBtn.style.display = (compareMode && highlightMode) ? 'flex' : 'none';

    if (quickSwitchBtn) quickSwitchBtn.style.display = (lastTwoDates[1] && !compareMode) ? 'flex' : 'none';

    toggleIconImg.src = showingDisney ? 'icons/satellite.svg' : 'icons/mouse.svg';
    toggleIconImg.alt = showingDisney ? 'Satellite' : 'Disney Map';

    swipeThumb.style.display = (compareMode && !highlightMode) ? 'block' : 'none';
    swipeHandle.style.display = (compareMode && !highlightMode) ? 'block' : 'none';
    sensitivityRow.style.display = (compareMode && highlightMode && showSensitivity) ? 'block' : 'none';

    compareBtn.classList.toggle('active-btn', compareMode);
    highlightBtn.classList.toggle('active-btn', compareMode && showingDisney && highlightMode);
    settingsBtn.classList.toggle('active-btn', compareMode && highlightMode && showSensitivity);

    updateSwipeUI();
    updateDateNavArrows();
  }

  // Helper: get the current nav key (code for Disney, esri_id for satellite)
  function getNavKey(mode) {
    // mode: 'current', 'left', 'right'
    if (showingDisney) {
      if (mode === 'left') return leftCode;
      if (mode === 'right') return rightCode;
      return currentCode;
    }
    if (mode === 'left') return leftSatEsriId;
    if (mode === 'right') return rightSatEsriId;
    return getCurrentSatId();
  }

  function updateDateNavArrows() {
    const navOpts = getNavOptions();
    if (!navOpts.length) {
      datePrevBtn.classList.add('disabled');
      dateNextBtn.classList.add('disabled');
      return;
    }

    let canPrev, canNext;

    if (!compareMode) {
      const idx = findNavIndex(getNavKey('current'), navOpts);
      canPrev = idx > 0;
      canNext = idx < navOpts.length - 1;
    } else {
      const leftIdx = findNavIndex(getNavKey('left'), navOpts);
      const rightIdx = findNavIndex(getNavKey('right'), navOpts);
      canPrev = leftIdx > 0;
      canNext = rightIdx < navOpts.length - 1;
    }

    datePrevBtn.classList.toggle('disabled', !canPrev);
    dateNextBtn.classList.toggle('disabled', !canNext);
  }

  function setSingleDate(newCode) {
    if (currentCode === newCode) return;
    if (currentCode && currentCode !== newCode) saveLastViewedCode(currentCode);
    if (lastTwoDates[0] !== newCode) lastTwoDates = [newCode, lastTwoDates[0]];
    currentCode = newCode;

    // Swap source instead of recreating the entire layer
    const newSource = makeDisneySource(newCode);
    if (parkExtent) newSource.set('extent', parkExtent);
    disneyLayer.setSource(newSource);

    const esriId = findClosestSatellite(getLabelForCode(newCode));
    const visE = esriLayer && esriLayer.getVisible();
    if (esriId && (!esriLayer || esriLayer.get('esri_id') !== esriId)) {
      if (esriLayer) map.removeLayer(esriLayer);
      esriLayer = makeEsriLayer(esriId);
      if (esriLayer) {
        esriLayer.set('esri_id', esriId);
        esriLayer.getSource().set('extent', parkExtent);
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
      leftLayer = makeEsriLayer(leftSatEsriId);
      rightLayer = makeEsriLayer(rightSatEsriId);
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

    positionPopup(datePopup, dateBtn);
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

    // Only show dates older than right date
    fillDatePopup(leftDatePopup, leftCode, (code) => {
      leftCode = code;
      saveLastLeftCode(code);
      (highlightMode ? launchHighlightMode : launchSwipeMode)();
      updateDateUI();
    }, 'olderThan', rightCode);

    positionPopup(leftDatePopup, leftDateBtn);
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

  // Switch satellite view to a given esri_id (single mode, non-compare)
  function setSatelliteView(esriId) {
    currentSatEsriId = esriId;
    if (!esriLayer || esriLayer.get('esri_id') !== esriId) {
      if (esriLayer) map.removeLayer(esriLayer);
      esriLayer = makeEsriLayer(esriId);
      if (esriLayer) {
        esriLayer.set('esri_id', esriId);
        esriLayer.getSource().set('extent', parkExtent);
        map.getLayers().setAt(1, esriLayer);
      }
    }
    if (esriLayer) esriLayer.setVisible(true);
    updateDateUI();
  }

  toggleBtn.addEventListener('click', () => {
    showingDisney = !showingDisney;

    if (!compareMode) {
      if (showingDisney) {
        disneyLayer.setVisible(true);
        if (esriLayer) esriLayer.setVisible(false);
      } else {
        disneyLayer.setVisible(false);
        // Map current Disney date to closest satellite version
        currentSatEsriId = findClosestSatellite(getLabelForCode(currentCode));
        setSatelliteView(currentSatEsriId);
      }
    } else {
      if (!showingDisney) {
        if (highlightMode) { highlightMode = false; showSensitivity = false; }
        // Map compare codes to satellite versions
        leftSatEsriId = findClosestSatellite(getLabelForCode(leftCode));
        rightSatEsriId = findClosestSatellite(getLabelForCode(rightCode));
      }
      (highlightMode ? launchHighlightMode : launchSwipeMode)();
    }

    setRoadsLayerState();
    updateDateUI();
  });

  compareBtn.addEventListener('click', () => {
    compareMode = !compareMode;

    if (compareMode) {
      const navOpts = getNavOptions();

      if (showingDisney) {
        // If user has viewed two different dates, use those (older on left, newer on right)
        if (lastTwoDates[0] && lastTwoDates[1] && lastTwoDates[0] !== lastTwoDates[1]) {
          const idx0 = findNavIndex(lastTwoDates[0], navOpts);
          const idx1 = findNavIndex(lastTwoDates[1], navOpts);
          if (idx0 >= 0 && idx1 >= 0) {
            // Lower index = older, higher index = newer
            if (idx0 < idx1) {
              leftCode = lastTwoDates[0];
              rightCode = lastTwoDates[1];
            } else {
              leftCode = lastTwoDates[1];
              rightCode = lastTwoDates[0];
            }
          } else {
            // Fallback if indices invalid
            rightCode = currentCode;
            const currentNavIdx = findNavIndex(currentCode, navOpts);
            leftCode = currentNavIdx > 0 ? navOpts[currentNavIdx - 1].code : currentCode;
          }
        } else {
          // No history: use current as right, nearest older as left
          rightCode = currentCode;
          const currentNavIdx = findNavIndex(currentCode, navOpts);
          leftCode = currentNavIdx > 0 ? navOpts[currentNavIdx - 1].code : currentCode;
        }
      } else {
        // Satellite mode: same logic with esri_id
        const curSat = getCurrentSatId();
        const curIdx = navOpts.findIndex(o => o.esri_id === curSat);
        // For satellite, just use nearest older (no lastTwoDates tracking for sat)
        rightSatEsriId = curSat;
        leftSatEsriId = curIdx > 0 ? navOpts[curIdx - 1].esri_id : curSat;
      }

      highlightMode = false;
      showSensitivity = false;
      launchSwipeMode();
    } else {
      highlightMode = false;
      showSensitivity = false;
      clearCompareLayers();
      swipeThumb.style.display = 'none';
      swipeHandle.style.display = 'none';
      sensitivityRow.style.display = 'none';
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

  if (quickSwitchBtn) quickSwitchBtn.addEventListener('click', () => {
    if (lastTwoDates[1]) setSingleDate(lastTwoDates[1]);
  });

  // TDR Day/Night toggle
  function refreshTdrLayer() {
    if (currentParkId !== 'tdr') return;

    const newSource = makeDisneySource(currentCode);
    if (parkExtent) newSource.set('extent', parkExtent);
    disneyLayer.setSource(newSource);
    setRoadsLayerState();
  }

  if (daynightBtn) {
    daynightBtn.addEventListener('click', () => {
      if (currentParkId !== 'tdr') return;
      tdrTimeMode = (tdrTimeMode === 'daytime') ? 'nighttime' : 'daytime';
      daynightBtn.classList.toggle('active-btn', tdrTimeMode === 'nighttime');
      daynightBtn.title = tdrTimeMode === 'daytime' ? 'Switch to Night Mode' : 'Switch to Day Mode';
      refreshTdrLayer();
    });
  }

  // TDR Rotate 90°
  if (rotateBtn) {
    rotateBtn.addEventListener('click', () => {
      if (currentParkId !== 'tdr') return;
      tdrRotation = (tdrRotation + 90) % 360;
      const view = map.getView();
      view.animate({
        rotation: tdrRotation * (Math.PI / 180),
        duration: 300
      });
    });
  }

  // Show/hide TDR buttons based on current park
  function updateTdrButtons() {
    const isTdr = (currentParkId === 'tdr');
    const park = getCurrentPark() || {};
    const hasRotPoints = Array.isArray(park.rotationPoints) && park.rotationPoints.length > 0;
    if (daynightBtn) daynightBtn.style.display = isTdr ? 'flex' : 'none';
    // Manual 90° rotate is superseded by the reference-point system
    if (rotateBtn) rotateBtn.style.display = (isTdr && !hasRotPoints) ? 'flex' : 'none';
  }

  // =====================
  // TDR reference-point rotation
  // The map's rotation at any spot is interpolated from a set of reference
  // points (rotationPoints in tdr_config.json), each a { coords, rotation }.
  // Uses inverse-distance-squared weighting with circular (angular) averaging
  // so values wrap correctly (e.g. 350 and 10 average to 0, not 180).
  // =====================
  let rotationConfigActive = false;   // service-mode config tool is open
  let rotationPointsDraft = [];       // working copy edited by that tool

  function computeRotationFromPoints(lonLat, pts, fallbackDeg) {
    if (!Array.isArray(pts) || !pts.length) return fallbackDeg || 0;
    const cosLat = Math.cos(lonLat[1] * Math.PI / 180);
    let sumX = 0, sumY = 0, sumW = 0;
    for (const p of pts) {
      if (!Array.isArray(p.coords)) continue;
      const dx = (lonLat[0] - p.coords[0]) * cosLat;
      const dy = lonLat[1] - p.coords[1];
      const d2 = dx * dx + dy * dy;
      const rad = (p.rotation || 0) * Math.PI / 180;
      if (d2 < 1e-14) return (((p.rotation || 0) % 360) + 360) % 360; // on the point
      const w = 1 / d2;
      sumX += w * Math.cos(rad);
      sumY += w * Math.sin(rad);
      sumW += w;
    }
    if (sumW === 0) return fallbackDeg || 0;
    const deg = Math.atan2(sumY, sumX) * 180 / Math.PI;
    return ((deg % 360) + 360) % 360;
  }

  // The point set in effect: the service-mode draft while configuring,
  // otherwise the park config's stored points
  function activeTdrRotationPoints() {
    if (rotationConfigActive) return rotationPointsDraft;
    const park = getCurrentPark() || {};
    return Array.isArray(park.rotationPoints) ? park.rotationPoints : [];
  }

  function tdrRotationForCenter(lonLat) {
    const park = getCurrentPark() || {};
    return computeRotationFromPoints(lonLat, activeTdrRotationPoints(), park.defaultRotation || 0);
  }

  // Re-orient the map to the interpolated rotation for the current center
  function applyTdrAutoRotation() {
    if (currentParkId !== 'tdr' || !map) return;
    const pts = activeTdrRotationPoints();
    if (!pts.length) return;
    const center = ol.proj.toLonLat(map.getView().getCenter());
    const targetRad = tdrRotationForCenter(center) * (Math.PI / 180);
    const cur = map.getView().getRotation() || 0;
    // Shortest angular difference; skip sub-0.25° churn to avoid feedback
    const diff = Math.atan2(Math.sin(targetRad - cur), Math.cos(targetRad - cur));
    if (Math.abs(diff) < (0.25 * Math.PI / 180)) return;
    map.getView().setRotation(targetRad);
  }

  // Coalesce continuous center changes (during a drag/inertia) to at most
  // one rotation update per frame, so the map re-orients live as you pan
  let rotationRafPending = false;
  function scheduleTdrAutoRotation() {
    if (rotationRafPending) return;
    rotationRafPending = true;
    requestAnimationFrame(() => {
      rotationRafPending = false;
      applyTdrAutoRotation();
    });
  }


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
      const within = ol.extent.containsCoordinate(parkExtent, projected);
      if (!within) {
        const parkName = getCurrentPark().name || 'the park';
        showFindMeMessage('Outside of ' + parkName);
        return;
      }

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

  // Share button - copy URL with current view state to clipboard
  const shareBtn = document.getElementById('share-btn');
  const toastMessage = document.getElementById('toast-message');

  function showToast(msg) {
    toastMessage.textContent = msg;
    toastMessage.style.display = 'block';
    setTimeout(() => { toastMessage.style.opacity = '1'; }, 10);
    setTimeout(() => {
      toastMessage.style.opacity = '0';
      setTimeout(() => { toastMessage.style.display = 'none'; }, 300);
    }, 2000);
  }

  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      const view = map.getView();
      const mapSize = map.getSize();
      // Get current view extent and convert to lon/lat
      const extent3857 = view.calculateExtent(mapSize);
      const extentLonLat = ol.proj.transformExtent(extent3857, 'EPSG:3857', 'EPSG:4326');

      // Build URL with extent instead of center+zoom
      const params = new URLSearchParams();
      params.set('park', currentParkId);
      // Encode extent as: minLng,minLat,maxLng,maxLat
      params.set('bbox', [
        extentLonLat[0].toFixed(6),
        extentLonLat[1].toFixed(6),
        extentLonLat[2].toFixed(6),
        extentLonLat[3].toFixed(6)
      ].join(','));
      params.set('date', showingDisney ? currentCode : ('sat_' + getCurrentSatId()));
      if (!showingDisney) params.set('view', 'sat');

      const url = window.location.origin + window.location.pathname + '?' + params.toString();

      navigator.clipboard.writeText(url).then(() => {
        showToast('Link copied to clipboard');
      }).catch(() => {
        // Fallback for older browsers
        showToast('Could not copy link');
      });
    });
  }

  function showDatePopupBelow(popupEl, anchorEl, fillFn) {
    if (popupEl.style.display === 'block') { hidePopup(popupEl); return; }
    fillFn();
    positionPopup(popupEl, anchorEl, { align: 'center' });
    showPopup(popupEl);

    const close = (e) => {
      if (!popupEl.contains(e.target) && !currentDateDisplay.contains(e.target)) {
        hidePopup(popupEl);
        document.removeEventListener('mousedown', close, true);
        document.removeEventListener('touchstart', close, true);
      }
    };
    setTimeout(() => {
      document.addEventListener('mousedown', close, true);
      document.addEventListener('touchstart', close, true);
    }, 0);
  }

  // Single mode: click on single-date-label opens date picker
  singleDateLabel.addEventListener('click', (e) => {
    if (compareMode) return;
    e.stopPropagation();
    showDatePopupBelow(datePopup, currentDateDisplay, () => {
      if (showingDisney) {
        fillDatePopup(datePopup, currentCode, setSingleDate);
      } else {
        fillDatePopup(datePopup, getCurrentSatId(), (esriId) => {
          setSatelliteView(esriId);
        });
      }
    });
  });

  // Compare mode: click on left-date-label opens left date picker
  leftDateLabel.addEventListener('click', (e) => {
    if (!compareMode) return;
    e.stopPropagation();
    const curKey = getNavKey('left');
    const constraintKey = getNavKey('right');
    showDatePopupBelow(leftDatePopup, leftDateLabel, () => {
      fillDatePopup(leftDatePopup, curKey, (picked) => {
        if (showingDisney) {
          leftCode = picked;
          saveLastLeftCode(picked);
        } else {
          leftSatEsriId = picked;
        }
        (highlightMode ? launchHighlightMode : launchSwipeMode)();
        updateDateUI();
      }, 'olderThan', constraintKey);
    });
  });

  // Compare mode: click on right-date-label opens right date picker
  rightDateLabel.addEventListener('click', (e) => {
    if (!compareMode) return;
    e.stopPropagation();
    const curKey = getNavKey('right');
    const constraintKey = getNavKey('left');
    showDatePopupBelow(datePopup, rightDateLabel, () => {
      fillDatePopup(datePopup, curKey, (picked) => {
        if (showingDisney) {
          rightCode = picked;
        } else {
          rightSatEsriId = picked;
        }
        (highlightMode ? launchHighlightMode : launchSwipeMode)();
        updateDateUI();
      }, 'newerThan', constraintKey);
    });
  });

  // Fallback: clicking on currentDateDisplay itself (not a label)
  currentDateDisplay.addEventListener('click', (e) => {
    if (e.target !== currentDateDisplay) return;
    if (!compareMode) {
      showDatePopupBelow(datePopup, currentDateDisplay, () => {
        if (showingDisney) {
          fillDatePopup(datePopup, currentCode, setSingleDate);
        } else {
          fillDatePopup(datePopup, getCurrentSatId(), (esriId) => {
            setSatelliteView(esriId);
          });
        }
      });
    }
  });

  // Date navigation arrows
  function navStep(direction) {
    const navOpts = getNavOptions();
    const delta = direction; // -1 = prev, +1 = next

    if (!compareMode) {
      const key = getNavKey('current');
      const idx = findNavIndex(key, navOpts);
      const newIdx = idx + delta;
      if (newIdx < 0 || newIdx >= navOpts.length) return;

      if (showingDisney) {
        setSingleDate(navOpts[newIdx].code);
      } else {
        setSatelliteView(navOpts[newIdx].esri_id);
      }
    } else {
      const leftIdx = findNavIndex(getNavKey('left'), navOpts);
      const rightIdx = findNavIndex(getNavKey('right'), navOpts);
      let changed = false;
      const newLeftIdx = leftIdx + delta;
      const newRightIdx = rightIdx + delta;

      if (showingDisney) {
        if (newLeftIdx >= 0 && newLeftIdx < navOpts.length) { leftCode = navOpts[newLeftIdx].code; changed = true; }
        if (newRightIdx >= 0 && newRightIdx < navOpts.length) { rightCode = navOpts[newRightIdx].code; changed = true; }
      } else {
        if (newLeftIdx >= 0 && newLeftIdx < navOpts.length) { leftSatEsriId = navOpts[newLeftIdx].esri_id; changed = true; }
        if (newRightIdx >= 0 && newRightIdx < navOpts.length) { rightSatEsriId = navOpts[newRightIdx].esri_id; changed = true; }
      }
      if (changed) {
        (highlightMode ? launchHighlightMode : launchSwipeMode)();
        updateDateUI();
      }
    }
  }

  datePrevBtn.addEventListener('click', () => {
    if (datePrevBtn.classList.contains('disabled')) return;
    navStep(-1);
  });

  dateNextBtn.addEventListener('click', () => {
    if (dateNextBtn.classList.contains('disabled')) return;
    navStep(+1);
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
  infoClose.addEventListener('click', () => { infoOverlay.classList.remove('open'); });
  infoOverlay.addEventListener('click', (e) => { if (e.target === infoOverlay) infoOverlay.classList.remove('open'); });

  // =====================
  // Service Mode (activated via the hidden spanner button on the About screen)
  // Shows current map center coordinates - click anywhere to copy
  // =====================
  let serviceMode = false;
  const serviceModeOverlay = document.getElementById('service-mode-overlay');
  const serviceModeCenter = document.getElementById('service-mode-center');
  const serviceModeClose = document.getElementById('service-mode-close');

  function updateServiceModeCenter() {
    if (!serviceMode || !map) return;
    const view = map.getView();
    const center = ol.proj.toLonLat(view.getCenter());
    const zoom = view.getZoom();
    const viewWidth = widthFromCurrentView();
    const coordText = `"coords": [${center[0].toFixed(6)}, ${center[1].toFixed(6)}], "width": ${viewWidth}`;
    let display = `[${center[0].toFixed(6)}, ${center[1].toFixed(6)}], zoom: ${zoom.toFixed(1)}\nview square: ${viewWidth}`;
    // Shanghai uses Baidu coordinate system - coordinates are not real-world lat/lon
    if (currentParkId === 'shdr') {
      display += '\n[Baidu coords - not WGS84]';
    }
    serviceModeCenter.textContent = display;
    // Store for clipboard: ready to paste into a park config location entry
    serviceModeCenter.dataset.copyText = coordText;

    updateLocationTool();
    if (rotationConfigActive) {
      drawRotationOverlay();
      updateRotationLive();
    }
  }

  // Map clicks in service mode: add a lasso vertex while drawing an area,
  // otherwise copy the center coords + width
  function serviceModeMapClick(evt) {
    if (locationToolActive && areaDrawing && evt && evt.coordinate) {
      addAreaVertex(evt.coordinate);
      return;
    }
    copyCenterToClipboard();
  }

  function copyCenterToClipboard() {
    if (!serviceMode || !map) return;
    const text = serviceModeCenter.dataset.copyText || '';
    if (!text) return;

    navigator.clipboard.writeText(text).then(() => {
      showToast('Coords + width copied');
    }).catch(() => {
      // Fallback: show alert if clipboard fails
      alert('Coordinates: ' + text);
    });
  }

  // =====================
  // Service Mode: location authoring tool
  // Preview the exact extent the dock/pill flyTo would fit for a
  // "coords" + "width" pair, and copy a ready-to-paste config line
  // =====================
  const locationsToggleBtn = document.getElementById('service-mode-locations-btn');
  const locationToolEl = document.getElementById('service-mode-location-tool');
  const locationWidthInput = document.getElementById('service-mode-width-input');
  const locationJsonEl = document.getElementById('service-mode-location-json');
  const locationCopyBtn = document.getElementById('service-mode-copy-location');
  const locationFitBtn = document.getElementById('service-mode-width-from-view');
  const locationSelect = document.getElementById('service-mode-location-select');
  const locationBaselineEl = document.getElementById('service-mode-location-baseline');
  const extentBoxEl = document.getElementById('service-mode-extent-box');
  const areaSvg = document.getElementById('service-mode-area-svg');
  const areaDrawBtn = document.getElementById('service-mode-area-draw');
  const areaUndoBtn = document.getElementById('service-mode-area-undo');
  const areaClearBtn = document.getElementById('service-mode-area-clear');
  const areaCountEl = document.getElementById('service-mode-area-count');
  let locationToolActive = false;
  let loadedLocation = null;      // baseline entry loaded from the park config
  let selectableLocations = [];   // flat list backing the select options
  let areaDrawing = false;        // lasso mode: map taps add polygon vertices
  let areaPoints = [];            // polygon vertices as [lon, lat]

  // The config "width" (degrees) whose view square exactly fills the
  // viewport's smaller dimension - i.e. reproduces the current view when
  // fitted by the dock/pill flyTo logic
  function widthFromCurrentView() {
    if (!map) return 0.008;
    const view = map.getView();
    const res = view.getResolution();
    const size = map.getSize();
    if (!Number.isFinite(res) || !size) return 0.008;
    const w = res * Math.min(size[0], size[1]) / METERS_PER_DEGREE;
    return parseFloat(w.toPrecision(3));
  }

  // Serialize a location entry in config.json field order; always emits an
  // explicit "hidden" flag (dock is deprecated) and carries rotation and
  // the "area" polygon ([[lon, lat], ...] hover zone) through
  function serializeLocation(loc) {
    let s = `{ "coords": [${loc.coords[0]}, ${loc.coords[1]}], "width": ${loc.width}, ` +
            `"icon": "${loc.icon || 'icons/locations/marker.svg'}", "alt": "${loc.alt || 'New Location'}"`;
    s += `, "hidden": ${loc.hidden === true}`;
    if (Array.isArray(loc.area) && loc.area.length) {
      s += ', "area": [' + loc.area.map((p) => `[${p[0]}, ${p[1]}]`).join(', ') + ']';
    }
    return s + ' }';
  }

  // The edited line: current crosshair center + width input, keeping the
  // loaded baseline's icon/alt/flags (or placeholders for a new location).
  // The lasso tool's polygon (3+ points) rides along as "area".
  function locationConfigLine() {
    const center = ol.proj.toLonLat(map.getView().getCenter());
    let w = parseFloat(locationWidthInput && locationWidthInput.value);
    if (!Number.isFinite(w) || w <= 0) w = widthFromCurrentView();
    const merged = Object.assign({}, loadedLocation || {}, {
      coords: [parseFloat(center[0].toFixed(6)), parseFloat(center[1].toFixed(6))],
      width: w
    });
    if (areaPoints.length >= 3) merged.area = areaPoints;
    else delete merged.area;
    return serializeLocation(merged);
  }

  // =====================
  // Area lasso: tap the map to add polygon vertices for the hover zone
  // =====================
  function setAreaDrawing(on) {
    areaDrawing = on;
    if (areaDrawBtn) {
      areaDrawBtn.classList.toggle('active', on);
      areaDrawBtn.textContent = on ? 'Drawing… (tap map)' : 'Draw area';
    }
  }

  function updateAreaStatus() {
    if (!areaCountEl) return;
    if (!areaPoints.length) {
      areaCountEl.textContent = 'No area polygon';
    } else {
      areaCountEl.textContent = `${areaPoints.length} point${areaPoints.length === 1 ? '' : 's'}` +
        (areaPoints.length < 3 ? ' — need 3+ for a polygon' : '');
    }
  }

  function addAreaVertex(coord3857) {
    const ll = ol.proj.toLonLat(coord3857);
    areaPoints.push([parseFloat(ll[0].toFixed(6)), parseFloat(ll[1].toFixed(6))]);
    updateAreaStatus();
    updateLocationTool();
  }

  function drawAreaOverlay() {
    if (!areaSvg) return;
    if (!serviceMode || !locationToolActive || !areaPoints.length) {
      areaSvg.innerHTML = '';
      return;
    }

    const px = areaPoints
      .map((p) => map.getPixelFromCoordinate(ol.proj.fromLonLat(p)))
      .filter((p) => p);
    if (px.length !== areaPoints.length) { areaSvg.innerHTML = ''; return; }

    const pts = px.map((p) => `${p[0]},${p[1]}`).join(' ');
    let html = '';
    if (px.length >= 3) {
      html += `<polygon points="${pts}" fill="rgba(255,140,0,0.15)" ` +
              `stroke="rgba(255,140,0,0.95)" stroke-width="2" stroke-dasharray="6 4"/>`;
    } else if (px.length === 2) {
      html += `<polyline points="${pts}" fill="none" ` +
              `stroke="rgba(255,140,0,0.95)" stroke-width="2" stroke-dasharray="6 4"/>`;
    }
    px.forEach((p, i) => {
      html += `<circle cx="${p[0]}" cy="${p[1]}" r="4" ` +
              `fill="${i === 0 ? '#fff' : 'rgba(255,140,0,0.95)'}" ` +
              `stroke="rgba(255,140,0,0.95)" stroke-width="2"/>`;
    });
    areaSvg.innerHTML = html;
  }

  // Fill the "Load existing" dropdown from the current park's config
  function populateLocationSelect() {
    if (!locationSelect) return;
    const park = getCurrentPark() || {};
    const groups = (Array.isArray(park.locationGroups) && park.locationGroups.length)
      ? park.locationGroups
      : (Array.isArray(park.locations) && park.locations.length
          ? [{ name: 'Locations', locations: park.locations }]
          : []);

    selectableLocations = [];
    locationSelect.innerHTML = '<option value="">Load existing location…</option>';

    groups.forEach((group) => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = group.name || 'Locations';
      group.locations.forEach((loc) => {
        const opt = document.createElement('option');
        opt.value = String(selectableLocations.length);
        opt.textContent = loc.alt || 'Location';
        optgroup.appendChild(opt);
        selectableLocations.push(loc);
      });
      if (optgroup.children.length) locationSelect.appendChild(optgroup);
    });
  }

  function loadBaselineLocation(loc) {
    loadedLocation = loc;

    // Seed the lasso with the baseline's area polygon (copy, not reference)
    setAreaDrawing(false);
    areaPoints = (loc && Array.isArray(loc.area)) ? loc.area.map((p) => p.slice()) : [];
    updateAreaStatus();

    if (locationBaselineEl) {
      if (loc) {
        locationBaselineEl.style.display = 'block';
        locationBaselineEl.textContent = serializeLocation(loc);
      } else {
        locationBaselineEl.style.display = 'none';
        locationBaselineEl.textContent = '';
      }
    }

    if (!loc || !Array.isArray(loc.coords)) {
      updateLocationTool();
      return;
    }

    // Seed the width from the baseline and fly to its view square so the
    // dashed box shows exactly what the config currently produces
    const w = parseFloat(loc.width) || 0.008;
    if (locationWidthInput) locationWidthInput.value = w;

    map.getView().fit(squareExtent3857(loc.coords[0], loc.coords[1], w), { duration: 450 });
  }

  function updateLocationTool() {
    if (!serviceMode || !locationToolActive || !map || !extentBoxEl) return;

    drawAreaOverlay();

    const w = parseFloat(locationWidthInput.value);
    if (!Number.isFinite(w) || w <= 0) {
      extentBoxEl.style.display = 'none';
      return;
    }

    if (locationJsonEl) locationJsonEl.textContent = locationConfigLine();

    // Draw the view square for center + width in screen pixels
    const center = ol.proj.toLonLat(map.getView().getCenter());
    const extent = squareExtent3857(center[0], center[1], w);
    const topLeft = map.getPixelFromCoordinate([extent[0], extent[3]]);
    const bottomRight = map.getPixelFromCoordinate([extent[2], extent[1]]);
    if (!topLeft || !bottomRight) {
      extentBoxEl.style.display = 'none';
      return;
    }

    extentBoxEl.style.display = 'block';
    extentBoxEl.style.left = topLeft[0] + 'px';
    extentBoxEl.style.top = topLeft[1] + 'px';
    extentBoxEl.style.width = (bottomRight[0] - topLeft[0]) + 'px';
    extentBoxEl.style.height = (bottomRight[1] - topLeft[1]) + 'px';
  }

  if (locationsToggleBtn) {
    locationsToggleBtn.addEventListener('click', () => {
      locationToolActive = !locationToolActive;
      locationsToggleBtn.classList.toggle('active', locationToolActive);
      if (locationToolEl) locationToolEl.style.display = locationToolActive ? 'block' : 'none';
      if (!locationToolActive) {
        if (extentBoxEl) extentBoxEl.style.display = 'none';
        if (areaSvg) areaSvg.innerHTML = '';
        setAreaDrawing(false);
        return;
      }
      populateLocationSelect();
      updateAreaStatus();
      // Seed the width from whatever is on screen right now
      if (locationWidthInput && !locationWidthInput.value) {
        locationWidthInput.value = widthFromCurrentView();
      }
      updateLocationTool();
    });
  }

  if (locationSelect) {
    locationSelect.addEventListener('change', () => {
      const idx = parseInt(locationSelect.value, 10);
      loadBaselineLocation(Number.isFinite(idx) ? selectableLocations[idx] || null : null);
    });
  }

  if (areaDrawBtn) {
    areaDrawBtn.addEventListener('click', () => setAreaDrawing(!areaDrawing));
  }
  if (areaUndoBtn) {
    areaUndoBtn.addEventListener('click', () => {
      areaPoints.pop();
      updateAreaStatus();
      updateLocationTool();
    });
  }
  if (areaClearBtn) {
    areaClearBtn.addEventListener('click', () => {
      areaPoints = [];
      setAreaDrawing(false);
      updateAreaStatus();
      updateLocationTool();
    });
  }

  if (locationWidthInput) locationWidthInput.addEventListener('input', updateLocationTool);

  if (locationFitBtn) {
    locationFitBtn.addEventListener('click', () => {
      if (locationWidthInput) locationWidthInput.value = widthFromCurrentView();
      updateLocationTool();
    });
  }

  if (locationCopyBtn) {
    locationCopyBtn.addEventListener('click', () => {
      const line = locationConfigLine() + ',';
      navigator.clipboard.writeText(line)
        .then(() => showToast('Location config line copied'))
        .catch(() => alert(line));
    });
  }

  // =====================
  // Service Mode: TDR rotation reference-point configuration tool
  // =====================
  const rotationConfigWrap = document.getElementById('service-mode-rotation');
  const rotationConfigBtn = document.getElementById('service-mode-rotation-btn');
  const rotationConfigTool = document.getElementById('service-mode-rotation-tool');
  const rotationLiveEl = document.getElementById('service-mode-rotation-live');
  const rotationDegInput = document.getElementById('service-mode-rotation-deg');
  const rotationAddBtn = document.getElementById('service-mode-rotation-add');
  const rotationListEl = document.getElementById('service-mode-rotation-list');
  const rotationCopyBtn = document.getElementById('service-mode-rotation-copy');
  const rotationSvg = document.getElementById('service-mode-rotation-svg');

  function loadRotationDraft() {
    const park = getCurrentPark() || {};
    rotationPointsDraft = (Array.isArray(park.rotationPoints) ? park.rotationPoints : [])
      .filter((p) => Array.isArray(p.coords))
      .map((p) => ({ coords: [p.coords[0], p.coords[1]], rotation: p.rotation || 0 }));
  }

  function rotationPointsJson() {
    const lines = rotationPointsDraft.map((p) =>
      `    { "coords": [${p.coords[0]}, ${p.coords[1]}], "rotation": ${p.rotation} }`);
    return '"rotationPoints": [\n' + lines.join(',\n') + '\n  ]';
  }

  function renderRotationList() {
    if (!rotationListEl) return;
    rotationListEl.innerHTML = '';
    if (!rotationPointsDraft.length) {
      rotationListEl.textContent = 'No reference points yet';
      return;
    }
    rotationPointsDraft.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'rot-item';
      const label = document.createElement('span');
      label.textContent = `${p.rotation}° @ ${p.coords[0].toFixed(5)}, ${p.coords[1].toFixed(5)}`;
      row.appendChild(label);
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '✕';
      del.title = 'Remove point';
      del.addEventListener('click', () => {
        rotationPointsDraft.splice(i, 1);
        renderRotationList();
        drawRotationOverlay();
        updateRotationLive();
      });
      row.appendChild(del);
      rotationListEl.appendChild(row);
    });
  }

  function updateRotationLive() {
    if (!rotationLiveEl || !map) return;
    const center = ol.proj.toLonLat(map.getView().getCenter());
    const park = getCurrentPark() || {};
    const deg = computeRotationFromPoints(center, rotationPointsDraft, park.defaultRotation || 0);
    rotationLiveEl.textContent = Math.round(deg);
  }

  function drawRotationOverlay() {
    if (!rotationSvg) return;
    if (!serviceMode || !rotationConfigActive || !rotationPointsDraft.length) {
      rotationSvg.innerHTML = '';
      return;
    }
    let html = '';
    rotationPointsDraft.forEach((p) => {
      const px = map.getPixelFromCoordinate(ol.proj.fromLonLat(p.coords));
      if (!px) return;
      const rad = (p.rotation || 0) * Math.PI / 180;
      const L = 28;
      const ex = px[0] + L * Math.sin(rad);
      const ey = px[1] - L * Math.cos(rad);
      html += `<line x1="${px[0]}" y1="${px[1]}" x2="${ex}" y2="${ey}" ` +
              `stroke="#12bdf0" stroke-width="2.5"/>`;
      html += `<circle cx="${px[0]}" cy="${px[1]}" r="5" fill="#12bdf0" ` +
              `stroke="#fff" stroke-width="2"/>`;
      html += `<text x="${px[0] + 9}" y="${px[1] - 9}" fill="#12bdf0" ` +
              `font-size="12" font-family="monospace" ` +
              `stroke="#003" stroke-width="0.4" paint-order="stroke">${p.rotation}°</text>`;
    });
    rotationSvg.innerHTML = html;
  }

  function updateRotationConfigVisibility() {
    if (rotationConfigWrap) {
      rotationConfigWrap.style.display = (currentParkId === 'tdr') ? 'block' : 'none';
    }
  }

  if (rotationConfigBtn) {
    rotationConfigBtn.addEventListener('click', () => {
      rotationConfigActive = !rotationConfigActive;
      rotationConfigBtn.classList.toggle('active', rotationConfigActive);
      if (rotationConfigTool) {
        rotationConfigTool.style.display = rotationConfigActive ? 'block' : 'none';
      }
      if (rotationConfigActive) {
        loadRotationDraft();
        renderRotationList();
        drawRotationOverlay();
        updateRotationLive();
      } else if (rotationSvg) {
        rotationSvg.innerHTML = '';
      }
    });
  }

  if (rotationAddBtn) {
    rotationAddBtn.addEventListener('click', () => {
      const deg = parseFloat(rotationDegInput && rotationDegInput.value);
      if (!Number.isFinite(deg)) { showToast('Enter a rotation in degrees'); return; }
      const center = ol.proj.toLonLat(map.getView().getCenter());
      rotationPointsDraft.push({
        coords: [parseFloat(center[0].toFixed(6)), parseFloat(center[1].toFixed(6))],
        rotation: ((Math.round(deg) % 360) + 360) % 360
      });
      renderRotationList();
      drawRotationOverlay();
      updateRotationLive();
    });
  }

  if (rotationCopyBtn) {
    rotationCopyBtn.addEventListener('click', () => {
      const txt = rotationPointsJson();
      navigator.clipboard.writeText(txt)
        .then(() => showToast('rotationPoints JSON copied'))
        .catch(() => alert(txt));
    });
  }

  function updateServiceModeServerInfo() {
    const serverSpan = document.getElementById('service-mode-current-server');
    if (!serverSpan) return;

    if (showingDisney) {
      serverSpan.textContent = currentCode || '--';
    } else {
      serverSpan.textContent = 'sat_' + (currentSatEsriId || '--');
    }

    // Show TDR cookie expiry if viewing TDR
    updateTdrCookieExpiry();
  }

  function updateTdrCookieExpiry() {
    let expiryEl = document.getElementById('service-mode-tdr-expiry');
    const serverDiv = document.getElementById('service-mode-server');
    if (!serverDiv) return;

    // Create the expiry element if it doesn't exist
    if (!expiryEl) {
      expiryEl = document.createElement('div');
      expiryEl.id = 'service-mode-tdr-expiry';
      expiryEl.style.cssText = 'margin-top:8px;font-size:12px;color:#888;';
      serverDiv.appendChild(expiryEl);
    }

    // Only show for TDR
    if (currentParkId !== 'tdr' || !TDR_CONFIG.cookieExpires) {
      expiryEl.style.display = 'none';
      return;
    }

    expiryEl.style.display = 'block';
    const expiry = new Date(TDR_CONFIG.cookieExpires);
    const now = new Date();
    const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

    if (daysLeft <= 0) {
      expiryEl.innerHTML = '<span style="color:#d32f2f;">TDR cookies EXPIRED</span>';
    } else if (daysLeft <= 3) {
      expiryEl.innerHTML = `<span style="color:#f57c00;">TDR cookies expire in ${daysLeft} day${daysLeft === 1 ? '' : 's'}</span>`;
    } else {
      expiryEl.textContent = `TDR cookies expire: ${expiry.toLocaleDateString()}`;
    }
  }

  const VERSION_CHECK_WORKER = 'https://disney-map-versions.gullet-erase2v.workers.dev/';

  // Cache for version check results (5 minute TTL)
  let versionCheckCache = null;
  let versionCheckCacheTime = 0;
  const VERSION_CHECK_CACHE_TTL = 5 * 60 * 1000;

  function getVersionCheckParks() {
    return Object.values(PARKS)
      .filter(p => p.versionCheck === true)
      .map(p => p.parkId);
  }

  async function checkAllLiveVersions() {
    const versionCheck = document.getElementById('service-mode-version-check');
    const versionStatus = document.getElementById('service-mode-version-status');
    const checkBtn = document.getElementById('service-mode-check-versions');
    if (!versionCheck || !versionStatus) return;

    const versionCheckParks = getVersionCheckParks();
    if (!versionCheckParks.length) {
      versionStatus.textContent = 'No parks configured for version checking';
      return;
    }

    // Check cache first
    const now = Date.now();
    if (versionCheckCache && (now - versionCheckCacheTime) < VERSION_CHECK_CACHE_TTL) {
      versionStatus.innerHTML = versionCheckCache;
      return;
    }

    versionCheck.className = 'checking';
    versionStatus.textContent = 'Checking versions...';
    if (checkBtn) checkBtn.disabled = true;

    try {
      const [liveRes, ...serverResults] = await Promise.all([
        fetch(VERSION_CHECK_WORKER),
        ...versionCheckParks.map(parkId =>
          fetch(`parks/${parkId}/${parkId}_dis_servers.json`)
            .then(r => r.ok ? r.json() : [])
            .catch(() => [])
        )
      ]);

      if (!liveRes.ok) throw new Error(`HTTP ${liveRes.status}`);
      const liveData = await liveRes.json();

      let html = '';
      versionCheckParks.forEach((parkId, i) => {
        const liveVersion = liveData[parkId]?.version;

        if (!liveVersion) {
          html += `<div class="park-version">${parkId.toUpperCase()}: <span style="color:#888">unavailable</span></div>`;
          return;
        }

        const servers = serverResults[i];
        const activeServers = Array.isArray(servers) ? servers.filter(s => s.active === 1) : [];
        const latestKnown = activeServers.length > 0 ? activeServers[activeServers.length - 1].code : null;

        const liveStr = String(liveVersion);
        const knownStr = latestKnown ? String(latestKnown) : '?';

        if (liveStr === knownStr) {
          html += `<div class="park-version">${parkId.toUpperCase()}: <span class="up-to-date">✓ ${liveStr}</span></div>`;
        } else {
          html += `<div class="park-version">${parkId.toUpperCase()}: <span class="new-version">NEW ${liveStr}</span> (known: ${knownStr})</div>`;
        }
      });

      // Cache the results
      versionCheckCache = html;
      versionCheckCacheTime = now;

      versionCheck.className = '';
      versionStatus.innerHTML = html;
    } catch (err) {
      console.warn('Version check failed:', err);
      versionCheck.className = '';
      versionStatus.textContent = 'Version check failed';
    } finally {
      if (checkBtn) checkBtn.disabled = false;
    }
  }

  function loadCustomServer() {
    const input = document.getElementById('service-mode-custom-input');
    if (!input) return;

    const customId = input.value.trim();
    if (!customId) {
      showToast('Enter a Disney map server ID');
      return;
    }

    // Load custom Disney map code
    loadCustomDisneyServer(customId);
    input.value = '';
  }

  function loadCustomDisneyServer(code) {
    // Load a custom Disney map server code (for testing)
    currentCode = code;

    // Create new Disney layer with custom code
    const newLayer = makeDisneyLayer(code);
    newLayer.setVisible(true);
    if (parkExtent) {
      newLayer.getSource().set('extent', parkExtent);
    }

    // Replace the Disney layer
    map.getLayers().setAt(0, newLayer);
    disneyLayer = newLayer;

    // Switch to Disney view if in satellite mode
    if (!showingDisney) {
      showingDisney = true;
      if (esriLayer) esriLayer.setVisible(false);
      disneyLayer.setVisible(true);
    }

    // Update UI
    const label = document.getElementById('single-date-label');
    if (label) label.textContent = code;

    updateServiceModeServerInfo();
    showToast(`Loaded: ${code}`);
  }

  // =====================
  // Service Mode: crosshair-centered zoom
  // While in service mode, wheel and pinch zoom about the map center
  // (the crosshair) instead of the cursor/finger position, so the
  // point being measured stays put
  // =====================
  let smWheelHandler = null;
  let smTouchStartHandler = null;
  let smTouchMoveHandler = null;
  let smTouchEndHandler = null;

  function setDefaultZoomInteractionsActive(active) {
    map.getInteractions().forEach((i) => {
      if (i instanceof ol.interaction.MouseWheelZoom || i instanceof ol.interaction.PinchZoom) {
        i.setActive(active);
      }
    });
  }

  function clampZoom(view, z) {
    return Math.max(view.getMinZoom(), Math.min(view.getMaxZoom(), z));
  }

  function enableCenteredZoom() {
    const mapDiv = map.getTargetElement();
    if (!mapDiv) return;

    setDefaultZoomInteractionsActive(false);

    // Wheel / trackpad: zoom about the center, scaled to the scroll delta
    smWheelHandler = (e) => {
      e.preventDefault();
      const view = map.getView();
      let dz = -e.deltaY / 250;
      dz = Math.max(-1, Math.min(1, dz));
      view.setZoom(clampZoom(view, (view.getZoom() || 0) + dz));
    };

    // Pinch: zoom about the center from the two-finger distance ratio
    let pinching = false;
    let pinchStartDist = 0;
    let pinchStartZoom = 0;
    const touchDist = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy) || 1;
    };

    smTouchStartHandler = (e) => {
      if (e.touches && e.touches.length === 2) {
        pinching = true;
        pinchStartDist = touchDist(e.touches);
        pinchStartZoom = map.getView().getZoom() || 0;
      }
    };
    smTouchMoveHandler = (e) => {
      if (!pinching || !e.touches || e.touches.length !== 2) return;
      e.preventDefault();
      const view = map.getView();
      const scale = touchDist(e.touches) / pinchStartDist;
      view.setZoom(clampZoom(view, pinchStartZoom + Math.log2(scale)));
    };
    smTouchEndHandler = (e) => {
      if (!e.touches || e.touches.length < 2) pinching = false;
    };

    mapDiv.addEventListener('wheel', smWheelHandler, { passive: false });
    mapDiv.addEventListener('touchstart', smTouchStartHandler, { passive: true });
    mapDiv.addEventListener('touchmove', smTouchMoveHandler, { passive: false });
    mapDiv.addEventListener('touchend', smTouchEndHandler, { passive: true });
  }

  function disableCenteredZoom() {
    const mapDiv = map.getTargetElement();

    setDefaultZoomInteractionsActive(true);

    if (mapDiv) {
      if (smWheelHandler) mapDiv.removeEventListener('wheel', smWheelHandler);
      if (smTouchStartHandler) mapDiv.removeEventListener('touchstart', smTouchStartHandler);
      if (smTouchMoveHandler) mapDiv.removeEventListener('touchmove', smTouchMoveHandler);
      if (smTouchEndHandler) mapDiv.removeEventListener('touchend', smTouchEndHandler);
    }
    smWheelHandler = smTouchStartHandler = smTouchMoveHandler = smTouchEndHandler = null;
  }

  function enableServiceMode() {
    serviceMode = true;
    serviceModeOverlay.style.display = 'block';

    // Initial center update
    updateServiceModeCenter();
    updateServiceModeServerInfo();

    // Zoom about the crosshair while in service mode
    enableCenteredZoom();

    // Rotation config tool is TDR-only; show its entry button accordingly
    updateRotationConfigVisibility();

    // Refresh the Locations tool's park location list
    populateLocationSelect();

    // Listen for map events - use 'postrender' for real-time updates during pan/zoom
    map.on('postrender', updateServiceModeCenter);
    map.on('click', serviceModeMapClick);

    // Setup custom server loading
    const loadBtn = document.getElementById('service-mode-load-custom');
    const customInput = document.getElementById('service-mode-custom-input');
    if (loadBtn) {
      loadBtn.onclick = loadCustomServer;
    }
    if (customInput) {
      customInput.onkeydown = (e) => {
        if (e.key === 'Enter') loadCustomServer();
      };
    }

    // Setup version check button
    const versionBtn = document.getElementById('service-mode-check-versions');
    if (versionBtn) {
      versionBtn.onclick = checkAllLiveVersions;
    }
  }

  function disableServiceMode() {
    serviceMode = false;
    serviceModeOverlay.style.display = 'none';

    // Restore normal cursor/finger-anchored zoom
    disableCenteredZoom();

    setAreaDrawing(false);

    // Close the rotation config tool and clear its overlay
    rotationConfigActive = false;
    if (rotationConfigBtn) rotationConfigBtn.classList.remove('active');
    if (rotationConfigTool) rotationConfigTool.style.display = 'none';
    if (rotationSvg) rotationSvg.innerHTML = '';

    // Remove listeners
    map.un('postrender', updateServiceModeCenter);
    map.un('click', serviceModeMapClick);
  }

  infoIcon.addEventListener('click', () => {
    infoOverlay.classList.add('open');
  });

  // Secret service mode entry: inconspicuous spanner button on the About
  // screen, gated behind a password prompt
  const serviceModeSecretBtn = document.getElementById('service-mode-secret');
  if (serviceModeSecretBtn) {
    serviceModeSecretBtn.addEventListener('click', () => {
      const pw = window.prompt('Enter password:');
      if (pw === null) return; // cancelled
      if (pw === 'service') {
        infoOverlay.classList.remove('open');
        enableServiceMode();
      } else {
        showToast('Incorrect password');
      }
    });
  }

  if (serviceModeClose) {
    serviceModeClose.addEventListener('click', disableServiceMode);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (serviceMode) {
        disableServiceMode();
      } else if (infoOverlay.classList.contains('open')) {
        infoOverlay.classList.remove('open');
      }
    }
  });

  // =====================
// Boot
// =====================
(async function boot() {
  // Load park configs first (required before accessing PARKS)
  await loadParkConfigs();

  const disUrl = getServersUrl(currentParkId);
  const satUrl = getSatServersUrl(currentParkId);
  const fallbackDisUrl = getServersUrl('wdw');
  const fallbackSatUrl = getSatServersUrl('wdw');

  // Read URL params for shared view state
  const urlParams = new URLSearchParams(window.location.search);
  const urlBbox = urlParams.get('bbox'); // New: extent-based (minLng,minLat,maxLng,maxLat)
  const urlLat = parseFloat(urlParams.get('lat')); // Legacy: center-based
  const urlLng = parseFloat(urlParams.get('lng'));
  const urlZoom = parseFloat(urlParams.get('z'));
  const urlDate = urlParams.get('date');
  const urlView = urlParams.get('view');

  try {
    let [disRes, satRes] = await Promise.all([
      fetch(disUrl, { cache: 'no-store' }),
      fetch(satUrl, { cache: 'no-store' })
    ]);

    // Fall back to WDW if park files missing (and switch park context)
    let fellBackToWdw = false;
    if (!disRes.ok && currentParkId !== 'wdw') {
      console.warn(`Failed to load ${currentParkId} servers, falling back to WDW`);
      disRes = await fetch(fallbackDisUrl, { cache: 'no-store' });
      satRes = await fetch(fallbackSatUrl, { cache: 'no-store' });
      if (disRes.ok) {
        currentParkId = 'wdw';
        fellBackToWdw = true;
      }
    }
    if (!disRes.ok) throw new Error(`Disney servers ${disRes.status}`);

    const allDis = await disRes.json();
    serverOptions = allDis.filter(o => o.active === 1);
    currentCode = serverOptions[serverOptions.length - 1].code;
    lastTwoDates = [currentCode, null];

    // Satellite list (may be empty for some parks)
    if (satRes.ok) {
      const allSat = await satRes.json();
      satOptions = allSat.filter(o => o.active === 1);
    } else {
      satOptions = [];
    }

    // Apply URL date param if present
    if (urlDate) {
      if (urlDate.startsWith('sat_')) {
        // Satellite mode with specific esri_id
        const esriId = urlDate.substring(4);
        if (satOptions.some(o => o.esri_id === esriId)) {
          currentSatEsriId = esriId;
          showingDisney = false;
        }
      } else {
        // Disney mode with specific code
        if (serverOptions.some(o => o.code === urlDate)) {
          currentCode = urlDate;
        }
      }
    } else if (urlView === 'sat') {
      showingDisney = false;
      currentSatEsriId = satOptions.length ? satOptions[satOptions.length - 1].esri_id : '';
    }

    initMap();
    enableDoubleTapHoldZoom();

    // Apply URL position if present
    if (urlBbox) {
      // New bbox format: minLng,minLat,maxLng,maxLat
      const parts = urlBbox.split(',').map(parseFloat);
      if (parts.length === 4 && parts.every(n => !isNaN(n))) {
        const extentLonLat = parts; // [minLng, minLat, maxLng, maxLat]
        const extent3857 = ol.proj.transformExtent(extentLonLat, 'EPSG:4326', 'EPSG:3857');
        map.getView().fit(extent3857, { duration: 0 });
      }
    } else if (!isNaN(urlLat) && !isNaN(urlLng)) {
      // Legacy center+zoom format
      const center = ol.proj.fromLonLat([urlLng, urlLat]);
      const zoom = !isNaN(urlZoom) ? urlZoom : map.getView().getZoom();
      map.getView().setCenter(center);
      map.getView().setZoom(zoom);
    }

    // Apply satellite view if specified
    if (!showingDisney) {
      disneyLayer.setVisible(false);
      setSatelliteView(currentSatEsriId);
    }

    updateDateUI();
    updateTdrButtons();

    // Expose bridge
    window.WDWMX.ol = ol;
    window.WDWMX.getMap = () => map;
    window.WDWMX.getCurrentCode = () => currentCode;
    window.WDWMX.getRightCode = () => rightCode;
    window.WDWMX.getCompareMode = () => compareMode;
    window.WDWMX.getShowingDisney = () => showingDisney;
    window.WDWMX.getLabelForCode = (code) => getLabelForCode(code);
    window.WDWMX.setSingleDate = (code) => setSingleDate(code);
    // Mode-agnostic nav bridge: works for Disney dates and satellite versions.
    // Items are { key, label } where key is a Disney code or an esri_id.
    window.WDWMX.getNavList = () =>
      getNavOptions().map((o) => ({ key: showingDisney ? o.code : o.esri_id, label: o.label }));
    window.WDWMX.getNavKey = (which) => getNavKey(which);
    window.WDWMX.setSingleNav = (key) => {
      if (showingDisney) setSingleDate(key);
      else setSatelliteView(key);
    };
    window.WDWMX.setCompareNav = (side, key) => {
      if (!compareMode) return;
      if (showingDisney) {
        if (side === 'left') { leftCode = key; saveLastLeftCode(key); }
        else { rightCode = key; }
        (highlightMode ? launchHighlightMode : launchSwipeMode)();
      } else {
        if (side === 'left') leftSatEsriId = key;
        else rightSatEsriId = key;
        launchSwipeMode();
      }
      updateDateUI();
    };
    window.WDWMX.getServers = () => serverOptions;
    window.WDWMX.getSatServers = () => satOptions;
    window.WDWMX.getServersUrl = (parkId) => getServersUrl(parkId);
    window.WDWMX.getSatServersUrl = (parkId) => getSatServersUrl(parkId);
    window.WDWMX.getParkId = () => currentParkId;
    window.WDWMX.getPark = () => getCurrentPark();
    // Parks with "enabled": false in their config are kept loadable (via URL
    // param) but left out of the park selector, e.g. during internal works
    window.WDWMX.getParks = () => Object.values(PARKS)
      .filter((p) => p.enabled !== false)
      .map(p => ({ parkId: p.parkId, name: p.name }));

  } catch (err) {
    alert('Failed to load server data: ' + err);
  }
})();

})();
