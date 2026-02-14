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
  // Tokyo Disney Resort Configuration
  // Update these values when CloudFront cookies expire
  // =====================
  const TDR_CONFIG = {
    // Base URL for TDR map tiles (date code may need updating)
    // {mode} will be replaced with 'daytime' or 'nighttime'
    tileBaseUrl: 'https://contents-portal.tokyodisneyresort.jp/limited/map-image/20260122183830/{mode}/',
    // Required User-Agent header
    userAgent: 'Disney Resort/3.10.9 (jp.tokyodisneyresort.portalapp; build:4; iOS 26.2.1) Alamofire/5.10.2',
    // CloudFront signed cookies (time-limited, update when expired)
    cookies: {
      'CloudFront-Signature': 'cwTUHMSzbLVk8hGDDQKJRIdzeS9J4FTjvt8~A4kBUL9cyslMKXoEA9~M8OGDvnyZu6g8vjn6ssJ8DgrD35Njt2DJLN1KpV6k4PapQEe2Rpa-oWWfl6xAsu39QEF1wGRdvAcGh1QvP2DSq8wIij7101f7lye55iE~FCJBNShCh-ukO5jZkokgCkKWw7C9SHOnU6FLoXi4CC3yFAA65p-p2cYrSFk-o3PvaVEL8L2Hpa4kiJMnwiU6FQupYMCclgC3093LB32ow8od~2jGYKCop1a0dV7P84Hd9JmbCALE0JDLNrRrJNFzDyHSlrONobdrKzMcDjv8zvcpqrp4NUVUag__',
      'CloudFront-Key-Pair-Id': 'APKAIJUGP2GGEWDAPMTQ',
      'CloudFront-Policy': 'eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vY29udGVudHMtcG9ydGFsLnRva3lvZGlzbmV5cmVzb3J0LmpwLyoiLCJDb25kaXRpb24iOnsiRGF0ZUxlc3NUaGFuIjp7IkFXUzpFcG9jaFRpbWUiOjE3NzI0NDIzNzl9LCJJcEFkZHJlc3MiOnsiQVdTOlNvdXJjZUlwIjoiMC4wLjAuMC8wIn19fV19'
    },
    // Proxy URL - tiles are fetched through this worker to add required headers
    // ?mode=daytime or ?mode=nighttime is appended
    proxyUrl: 'https://wdw-magic-explorer-api.gullet-erase2v.workers.dev/tdr-tiles/'
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
  // Park-specific quick-access locations (lon, lat, zoom, icon, alt)
  // Generic marker icon used in dock until custom icons are added
  const PARK_LOCATIONS = {
    wdw: [
      { coords: [-81.581203, 28.418714], zoom: 17.5, icon: 'icons/locations/magic-kingdom.svg', alt: 'Magic Kingdom' },
      { coords: [-81.549385, 28.371715], zoom: 17, icon: 'icons/locations/epcot.svg', alt: 'Epcot' },
      { coords: [-81.560472, 28.356850], zoom: 17, icon: 'icons/locations/hollywood-studios.svg', alt: 'Hollywood Studios' },
      { coords: [-81.590567, 28.358037], zoom: 17, icon: 'icons/locations/animal-kingdom.svg', alt: 'Animal Kingdom' },
      { coords: [-81.529080, 28.366055], zoom: 18.5, icon: 'icons/locations/typhoon-lagoon.svg', alt: 'Typhoon Lagoon' },
      { coords: [-81.574719, 28.351948], zoom: 18.5, icon: 'icons/locations/blizzard-beach.svg', alt: 'Blizzard Beach' },
      { coords: [-81.518325, 28.370757], zoom: 17.5, icon: 'icons/locations/disney-springs.svg', alt: 'Disney Springs' }
    ],
    dlr: [
      { coords: [-117.918958, 33.812624], zoom: 18.6, icon: 'icons/locations/dlr/dlr-castle.svg', alt: 'Disneyland' },
      { coords: [-117.919703, 33.806176], zoom: 18.2, icon: 'icons/locations/dlr/california-adventure.svg', alt: 'California Adventure' },
      { coords: [-117.922899, 33.809130], zoom: 18.9, icon: 'icons/locations/dlr/downtown-disney.svg', alt: 'Downtown Disney' }
    ],
    dlp: [
      { coords: [2.775880, 48.872100], zoom: 17.5, icon: 'icons/locations/dlp/disneyland_park_paris.svg', alt: 'Disneyland Park' },
      { coords: [2.780500, 48.867200], zoom: 17.5, icon: 'icons/locations/dlp/disney_studios_paris.svg', alt: 'Walt Disney Studios' },
      { coords: [2.785800, 48.869800], zoom: 18, icon: 'icons/locations/marker.svg', alt: 'Disney Village' }
    ],
    hkdl: [
      { coords: [114.041407, 22.312656], zoom: 18.6, icon: 'icons/locations/hkdl/hkdl-castle.svg', alt: 'Hong Kong Disneyland' },
      { coords: [114.037813, 22.321810], zoom: 17.7, icon: 'icons/locations/marker.svg', alt: 'Inspiration Lake' },
      { coords: [114.044085, 22.307825], zoom: 18.8, icon: 'icons/locations/marker.svg', alt: 'Hong Kong Disneyland Hotel' },
      { coords: [114.038344, 22.307541], zoom: 19.0, icon: 'icons/locations/marker.svg', alt: 'Disney Explorers Lodge' },
      { coords: [114.036762, 22.308802], zoom: 19.0, icon: 'icons/locations/marker.svg', alt: "Disney's Hollywood Hotel" },
      { coords: [114.028908, 22.332418], zoom: 17.9, icon: 'icons/locations/marker.svg', alt: 'Disneyland Transportation Centre' },
      { coords: [114.045671, 22.316173], zoom: 18.0, icon: 'icons/locations/marker.svg', alt: 'Sunny Bay Station & Car Park' }
    ],
    shdr: [
      { coords: [-107.344478, -83.052295], zoom: 19.0, icon: 'icons/locations/shdr/shdr-castle.svg', alt: 'Disneyland Park' },
      { coords: [-107.338827, -83.052508], zoom: 18.7, icon: 'icons/locations/marker.svg', alt: 'Wishing Star Park' },
      { coords: [-107.340660, -83.052978], zoom: 19.6, icon: 'icons/locations/marker.svg', alt: 'Shanghai Disneyland Hotel' },
      { coords: [-107.348179, -83.052638], zoom: 19.5, icon: 'icons/locations/marker.svg', alt: 'Toy Story Hotel' },
      { coords: [-107.343507, -83.052561], zoom: 19.7, icon: 'icons/locations/marker.svg', alt: 'Disneytown' },
      { coords: [-107.339308, -83.053227], zoom: 19.8, icon: 'icons/locations/marker.svg', alt: 'Visitor Center & Parking' }
    ],
    tdr: [
      { coords: [139.880790, 35.632283], zoom: 18.2, rotation: 205, icon: 'icons/locations/tdr/tdr-castle.svg', alt: 'Tokyo Disneyland' },
      { coords: [139.885709, 35.625239], zoom: 17.5, rotation: 135, icon: 'icons/locations/tdr/disneysea.svg', alt: 'Tokyo DisneySea' },
      { coords: [139.887318, 35.633259], zoom: 18.0, rotation: 270, icon: 'icons/locations/tdr/ikspiari.svg', alt: 'Ikspiari' }
    ]
  };

  const PARKS = {
    wdw: {
      parkId: 'wdw',
      name: 'Walt Disney World',
      tileTemplate: 'https://cdn6.parksmedia.wdprapps.disney.com/media/maps/prod/{code}/{z}/{x}/{y}.jpg',
      minZoom: 11,
      maxZoom: 20,
      yScheme: 'xyz',
      defaultCenter: [-81.567406, 28.386276],
      defaultZoom: 13,
      boundsByZoom: {
        "11": { "minX": 555, "maxX": 564, "minY": 851, "maxY": 859 },
        "12": { "minX": 1118, "maxX": 1125, "minY": 1706, "maxY": 1715 },
        "13": { "minX": 2228, "maxX": 2251, "minY": 3412, "maxY": 3431 },
        "14": { "minX": 4456, "maxX": 4503, "minY": 6824, "maxY": 6863 },
        "15": { "minX": 8928, "maxX": 8987, "minY": 13672, "maxY": 13699 },
        "16": { "minX": 17856, "maxX": 17975, "minY": 27344, "maxY": 27399 },
        "17": { "minX": 35712, "maxX": 35951, "minY": 54688, "maxY": 54799 },
        "18": { "minX": 71424, "maxX": 71903, "minY": 109376, "maxY": 109599 },
        "19": { "minX": 143264, "maxX": 143455, "minY": 218752, "maxY": 219199 },
        "20": { "minX": 286528, "maxX": 286911, "minY": 437504, "maxY": 438399 }
      }
    },
    dlp: {
      parkId: 'dlp',
      name: 'Disneyland Paris',
      tileTemplate: 'https://media.disneylandparis.com/mapTiles/images/{z}/{x}/{y}.jpg',
      minZoom: 13,
      maxZoom: 20,
      yScheme: 'xyz',
      defaultCenter: [2.783115, 48.869832],
      defaultZoom: 15.3,
      boundsByZoom: {
        "13": { "minX": 4156, "maxX": 4161, "minY": 2816, "maxY": 2819 },
        "14": { "minX": 8312, "maxX": 8323, "minY": 5632, "maxY": 5639 },
        "15": { "minX": 16624, "maxX": 16647, "minY": 11264, "maxY": 11279 },
        "16": { "minX": 33248, "maxX": 33295, "minY": 22528, "maxY": 22559 },
"17": { "minX": 66496,  "maxX": 66591,  "minY": 45056,  "maxY": 45119 },
"18": { "minX": 132992, "maxX": 133183, "minY": 90112,  "maxY": 90239 },
"19": { "minX": 265984, "maxX": 266367, "minY": 180224, "maxY": 180479 },
"20": { "minX": 531968, "maxX": 532735, "minY": 360448, "maxY": 360959 }
      }
    },
    dlr: {
      parkId: 'dlr',
      name: 'Disneyland Resort (California)',
      tileTemplate: 'https://cdn6.parksmedia.wdprapps.disney.com/media/maps/prod/disneyland/{code}/{z}/{x}/{y}.jpg',
      minZoom: 14,
      maxZoom: 20,
      yScheme: 'xyz',
      defaultCenter: [-117.919108, 33.809960],
      defaultZoom: 16.0,
      boundsByZoom: {
        "14": { "minX": 2818, "maxX": 2831, "minY": 6549, "maxY": 6560 },
        "15": { "minX": 5636, "maxX": 5663, "minY": 13102, "maxY": 13117 },
        "16": { "minX": 11272, "maxX": 11327, "minY": 26208, "maxY": 26231 },
        "17": { "minX": 22544, "maxX": 22655, "minY": 52416, "maxY": 52463 },
        "18": { "minX": 45088, "maxX": 45311, "minY": 104832, "maxY": 104927 },
        "19": { "minX": 90176, "maxX": 90623, "minY": 209664, "maxY": 209855 },
        "20": { "minX": 180352, "maxX": 181247, "minY": 419328, "maxY": 419739 }
      }
    },
    hkdl: {
      parkId: 'hkdl',
      name: 'Hong Kong Disneyland',
      tileTemplate: 'https://cdn6.parksmedia.wdprapps.disney.com/media/maps/prod/hkdl/{code}/{z}/{x}/{y}.jpg',
      minZoom: 14,
      maxZoom: 20,
      yScheme: 'xyz',
      defaultCenter: [114.041267, 22.312071],
      defaultZoom: 17.6,
      boundsByZoom: {
        "14": { "minX": 13380, "maxX": 13383, "minY": 7148, "maxY": 7150 },
        "15": { "minX": 26762, "maxX": 26765, "minY": 14297, "maxY": 14300 },
        "16": { "minX": 53524, "maxX": 53531, "minY": 28594, "maxY": 28601 },
        "17": { "minX": 107048, "maxX": 107063, "minY": 57188, "maxY": 57203 },
        "18": { "minX": 214096, "maxX": 214127, "minY": 114376, "maxY": 114407 },
"19": { "minX": 428192, "maxX": 428255, "minY": 228752, "maxY": 228815 },
"20": { "minX": 856384, "maxX": 856511, "minY": 457504, "maxY": 457631 }
      }
    },
    shdr: {
      parkId: 'shdr',
      name: 'Shanghai Disney Resort',
      tileTemplate: 'https://secure.cdn1.wdpromedia.com/media/maps/prod/shdr-baidu-mob-en/{code}/{z}/{x}/{y}.jpg',
      minZoom: 14,
      maxZoom: 20,
      yScheme: 'tms', // server expects flipped Y
      // Shanghai uses Baidu coordinates - these are the "fake" WGS84 coords that map to correct tiles
      defaultCenter: [-107.344044, -83.052335],
      defaultZoom: 17.8,
      boundsByZoom: {
        "9": { "minX": 103, "maxX": 103, "minY": 27, "maxY": 27 },
        "10": { "minX": 206, "maxX": 206, "minY": 55, "maxY": 55 },
        "11": { "minX": 412, "maxX": 413, "minY": 110, "maxY": 111 },
        "12": { "minX": 825, "maxX": 827, "minY": 220, "maxY": 222 },
        "13": { "minX": 1651, "maxX": 1655, "minY": 441, "maxY": 444 },
        "14": { "minX": 3302, "maxX": 3310, "minY": 882, "maxY": 889 },
        "15": { "minX": 6609, "maxX": 6617, "minY": 1768, "maxY": 1776 },
        "16": { "minX": 13218, "maxX": 13235, "minY": 3536, "maxY": 3553 },
        "17": { "minX": 26447, "maxX": 26459, "minY": 7084, "maxY": 7095 },
        "18": { "minX": 52895, "maxX": 52919, "minY": 14168, "maxY": 14191 },
        "19": { "minX": 105791, "maxX": 105839, "minY": 28336, "maxY": 28383 },
        "20": { "minX": 211583, "maxX": 211679, "minY": 56672, "maxY": 56767 }
      }
    },
    tdr: {
      parkId: 'tdr',
      name: 'Tokyo Disney Resort',
      // TDR uses a proxy due to CloudFront authentication requirements
      // Tile format: z{z}/{x}_{y}.jpg (handled specially in makeDisneyLayer)
      tileTemplate: 'tdr-proxy', // Special marker - actual URL built in makeDisneyLayer
      minZoom: 16,
      maxZoom: 20,
      yScheme: 'xyz',
      defaultCenter: [139.880952, 35.631740],
      defaultZoom: 16.2,
      defaultRotation: 200, // degrees clockwise
 main
      // Approximate bounds for Tokyo Disney Resort area
      boundsByZoom: {
        "15": { "minX": 29115, "maxX": 29125, "minY": 12905, "maxY": 12915 },
        "16": { "minX": 58230, "maxX": 58250, "minY": 25810, "maxY": 25830 },
        "17": { "minX": 116460, "maxX": 116500, "minY": 51620, "maxY": 51660 },
        "18": { "minX": 232920, "maxX": 233000, "minY": 103240, "maxY": 103320 },
        "19": { "minX": 465840, "maxX": 466000, "minY": 206480, "maxY": 206640 },
        "20": { "minX": 931680, "maxX": 932000, "minY": 412960, "maxY": 413280 }
      }
    }
  };

  // Current park (default to WDW for now; UI switch can be added later)
  let currentParkId = 'wdw';

  // Park selection: URL param takes precedence, then localStorage, then default
  try {
    const urlPid = new URLSearchParams(window.location.search).get('park');
    const storedPid = localStorage.getItem('wdwmx:parkId');
    const candidate = (urlPid || storedPid || 'wdw').toLowerCase();
    if (PARKS[candidate]) currentParkId = candidate;
  } catch (e) {
    // ignore
  }


  function getCurrentPark() {
    return PARKS[currentParkId] || PARKS.wdw;
  }

  function getServersUrl(parkId) {
    const pid = parkId || currentParkId || 'wdw';
    return `parks/${pid}/servers.json`;
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
  let currentCode = null;
  let leftCode = null;
  let rightCode = null;
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

  function isValidCode(code) {
    return !!code && serverOptions.some((o) => o.code === code);
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
  function makeDisneyLayer(code) {
    const park = getCurrentPark();
    const tpl = String(park.tileTemplate || '');

    // TDR uses a special proxy for CloudFront authentication
    const isTdr = (park.parkId === 'tdr');

    return new ol.layer.Tile({
      source: new ol.source.XYZ({
        minZoom: park.minZoom,
        maxZoom: park.maxZoom,
        tileUrlFunction: function (tileCoord) {
          if (!tileCoord) return '';
          const z = tileCoord[0];
          const x = tileCoord[1];
          const y = tileCoord[2];

          const n = Math.pow(2, z);
          const yy = (park.yScheme === 'tms') ? ((n - 1) - y) : y;

          // TDR: use proxy URL with special tile format z{z}/{x}_{y}.jpg?mode=daytime/nighttime
          if (isTdr) {
            return TDR_CONFIG.proxyUrl + `z${z}/${x}_${yy}.jpg?mode=${tdrTimeMode}`;
          }

          let url = tpl;
          if (url.indexOf('{code}') >= 0) url = url.replace('{code}', String(code));
          url = url.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(yy));
          return url;
        }
      }),
      visible: true
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
    const park = getCurrentPark();
    const baseUrlTpl = (park.tileTemplate.indexOf('{code}') >= 0)
      ? park.tileTemplate.replace('{code}', String(baseCode))
      : park.tileTemplate;
    const compareUrlTpl = (park.tileTemplate.indexOf('{code}') >= 0)
      ? park.tileTemplate.replace('{code}', String(compareCode))
      : park.tileTemplate;

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
            .replace('{y}', String((park.yScheme === 'tms') ? ((Math.pow(2, zxy[0]) - 1) - zxy[2]) : zxy[2]));

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
    let initialRotation = 0;

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

    // Apply default rotation if set (e.g., TDR)
    if (park.defaultRotation) {
      initialRotation = park.defaultRotation * (Math.PI / 180);
      // Keep tdrRotation in sync for the rotate button
      if (park.parkId === 'tdr') {
        tdrRotation = park.defaultRotation;
      }
    }

    map = new ol.Map({
      target: 'map',
      layers: [disneyLayer, esriLayer, roadsLayer].filter(Boolean),
      view: new ol.View({
        center: initialCenter,
        zoom: initialZoom,
        rotation: initialRotation,
        minZoom: park.minZoom,
        maxZoom: park.maxZoom,
        extent: parkExtent || undefined,
        constrainOnlyCenter: true  // Allows zooming out while keeping center in bounds
      }),
      controls: ol.control.defaults.defaults({ zoom: false, rotate: false }),
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

    // Dock quick pan - populate based on current park
    const dock = document.getElementById('location-dock');
    if (dock) {
      const locations = PARK_LOCATIONS[currentParkId] || [];

      if (currentParkId !== 'wdw') {
        // Clear the hardcoded WDW buttons and populate with park-specific locations
        dock.innerHTML = '';

        locations.forEach((loc) => {
          const btn = document.createElement('button');
          btn.dataset.coords = loc.coords.join(',');
          btn.dataset.zoom = String(loc.zoom);
          if (loc.rotation !== undefined) {
            btn.dataset.rotation = String(loc.rotation);
          }
          btn.title = loc.alt; // Tooltip on hover

          const img = document.createElement('img');
          img.src = loc.icon;
          img.alt = loc.alt;
          // Fallback to a generic marker if park-specific icon doesn't exist
          img.onerror = function() { this.src = 'icons/locations/marker.svg'; };

          btn.appendChild(img);
          dock.appendChild(btn);
        });
      }

      // Attach click handlers to all dock buttons (WDW has them in HTML, others are dynamic)
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

          // Apply rotation if specified (for TDR locations)
          const rotationDeg = parseFloat(btn.dataset.rotation);
          if (Number.isFinite(rotationDeg)) {
            tdrRotation = rotationDeg;
            map.getView().animate({
              center: target,
              zoom: targetZoom,
              rotation: rotationDeg * (Math.PI / 180),
              duration: 600
            });
          } else {
            map.getView().animate({ center: target, zoom: targetZoom, duration: 600 });
          }
        });
      });
    }
  }

        // Double-tap then drag up/down to zoom (mobile helper)
      // Works even with browser zoom disabled, because it adjusts the OpenLayers view zoom directly.
      function enableDoubleTapHoldZoom() {
        const mapDiv = map.getTargetElement();
        if (!mapDiv) return;

        let lastTap = 0;
        let isHoldZoom = false;
        let startY = 0;
        let startZoom = 0;

        function moveHandler(e) {
          if (!isHoldZoom || !e.touches || e.touches.length !== 1) return;
          e.preventDefault();

          const dy = e.touches[0].clientY - startY;
          const view = map.getView();

          // Drag up = zoom in, drag down = zoom out
          let newZoom = startZoom - (dy / 80);

          newZoom = Math.max(view.getMinZoom(), Math.min(view.getMaxZoom(), newZoom));
          view.setZoom(newZoom);
        }

        mapDiv.addEventListener('touchstart', (e) => {
          if (!e.touches || e.touches.length !== 1) return;

          const now = Date.now();
          const dt = now - lastTap;

          // Quick second tap enables hold-to-zoom
          if (dt > 0 && dt < 350) {
            e.preventDefault(); // prevents iOS smart zoom
            startY = e.touches[0].clientY;
            startZoom = map.getView().getZoom();
            isHoldZoom = true;

            mapDiv.addEventListener('touchmove', moveHandler, { passive: false });
          } else {
            isHoldZoom = false;
          }

          lastTap = now;
        }, { passive: false });

        mapDiv.addEventListener('touchend', () => {
          if (!isHoldZoom) return;
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

  function updateDateNavArrows() {
    if (!serverOptions.length) {
      datePrevBtn.style.display = 'none';
      dateNextBtn.style.display = 'none';
      return;
    }

    if (!compareMode) {
      // Single mode: prev = older (lower index), next = newer (higher index)
      const idx = serverOptions.findIndex(o => o.code === currentCode);
      datePrevBtn.style.display = (idx > 0) ? 'flex' : 'none';
      dateNextBtn.style.display = (idx < serverOptions.length - 1) ? 'flex' : 'none';
    } else {
      // Compare mode: arrows navigate both left and right dates
      // Prev = older direction (lower indices), next = newer direction (higher indices)
      const leftIdx = serverOptions.findIndex(o => o.code === leftCode);
      const rightIdx = serverOptions.findIndex(o => o.code === rightCode);
      // Show prev if either side can go older
      datePrevBtn.style.display = (leftIdx > 0 || rightIdx > 0) ? 'flex' : 'none';
      // Show next if either side can go newer
      dateNextBtn.style.display = (leftIdx < serverOptions.length - 1 || rightIdx < serverOptions.length - 1) ? 'flex' : 'none';
    }
  }

  function setSingleDate(newCode) {
    if (currentCode === newCode) return;
    if (currentCode && currentCode !== newCode) saveLastViewedCode(currentCode);
    if (lastTwoDates[0] !== newCode) lastTwoDates = [newCode, lastTwoDates[0]];
    currentCode = newCode;

    const visD = disneyLayer.getVisible();
    map.removeLayer(disneyLayer);
    disneyLayer = makeDisneyLayer(newCode);
    disneyLayer.setVisible(visD);
    disneyLayer.getSource().set('extent', parkExtent);
    map.getLayers().setAt(0, disneyLayer);

    const esriId = getEsriIdForCode(newCode);
    const visE = esriLayer && esriLayer.getVisible();
    if (!esriLayer || esriLayer.get('esri_id') !== esriId) {
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
      saveLastLeftCode(code);
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
            esriLayer.getSource().set('extent', parkExtent);
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
      // If the user has previously viewed another version for this park, flip the
      // sides so CURRENT is on the left and LAST VIEWED is on the right.
      // If there is no last-viewed value yet, keep the existing fallback:
      // previous-dated on the left, current on the right.
      const remembered = loadLastViewedCode();
      if (isValidCode(remembered) && remembered !== currentCode) {
        leftCode = currentCode;
        rightCode = remembered;
      } else {
        rightCode = currentCode;
        leftCode = chooseLeftCodeForCompare(currentCode);
      }
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

  if (quickSwitchBtn) quickSwitchBtn.addEventListener('click', () => {
    if (lastTwoDates[1]) setSingleDate(lastTwoDates[1]);
  });

  // TDR Day/Night toggle
  function refreshTdrLayer() {
    if (currentParkId !== 'tdr') return;

    const visD = disneyLayer.getVisible();
    map.removeLayer(disneyLayer);
    disneyLayer = makeDisneyLayer(currentCode);
    disneyLayer.setVisible(visD);
    disneyLayer.getSource().set('extent', parkExtent);
    map.getLayers().setAt(0, disneyLayer);
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
    if (daynightBtn) daynightBtn.style.display = isTdr ? 'flex' : 'none';
    if (rotateBtn) rotateBtn.style.display = isTdr ? 'flex' : 'none';
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

  // Date navigation arrows
  datePrevBtn.addEventListener('click', () => {
    if (!compareMode) {
      const idx = serverOptions.findIndex(o => o.code === currentCode);
      if (idx > 0) setSingleDate(serverOptions[idx - 1].code);
    } else {
      // Move both left and right one step older
      const leftIdx = serverOptions.findIndex(o => o.code === leftCode);
      const rightIdx = serverOptions.findIndex(o => o.code === rightCode);
      let changed = false;
      if (leftIdx > 0) { leftCode = serverOptions[leftIdx - 1].code; changed = true; }
      if (rightIdx > 0) { rightCode = serverOptions[rightIdx - 1].code; changed = true; }
      if (changed) {
        (highlightMode ? launchHighlightMode : launchSwipeMode)();
        updateDateUI();
      }
    }
  });

  dateNextBtn.addEventListener('click', () => {
    if (!compareMode) {
      const idx = serverOptions.findIndex(o => o.code === currentCode);
      if (idx < serverOptions.length - 1) setSingleDate(serverOptions[idx + 1].code);
    } else {
      // Move both left and right one step newer
      const leftIdx = serverOptions.findIndex(o => o.code === leftCode);
      const rightIdx = serverOptions.findIndex(o => o.code === rightCode);
      let changed = false;
      if (leftIdx < serverOptions.length - 1) { leftCode = serverOptions[leftIdx + 1].code; changed = true; }
      if (rightIdx < serverOptions.length - 1) { rightCode = serverOptions[rightIdx + 1].code; changed = true; }
      if (changed) {
        (highlightMode ? launchHighlightMode : launchSwipeMode)();
        updateDateUI();
      }
    }
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
  infoClose.addEventListener('click', () => { infoOverlay.style.display = 'none'; });
  infoOverlay.addEventListener('click', (e) => { if (e.target === infoOverlay) infoOverlay.style.display = 'none'; });

  // =====================
  // Service Mode (activated by clicking info icon 4 times in 1.5s)
  // Shows current map center coordinates - click anywhere to copy
  // =====================
  let serviceMode = false;
  let infoClickTimes = [];
  const serviceModeOverlay = document.getElementById('service-mode-overlay');
  const serviceModeCenter = document.getElementById('service-mode-center');
  const serviceModeClose = document.getElementById('service-mode-close');

  function updateServiceModeCenter() {
    if (!serviceMode || !map) return;
    const view = map.getView();
    const center = ol.proj.toLonLat(view.getCenter());
    const zoom = view.getZoom();
    const coordText = `[${center[0].toFixed(6)}, ${center[1].toFixed(6)}], zoom: ${zoom.toFixed(1)}`;
    let display = coordText;
    // Shanghai uses Baidu coordinate system - coordinates are not real-world lat/lon
    if (currentParkId === 'shdr') {
      display += '\n[Baidu coords - not WGS84]';
    }
    serviceModeCenter.textContent = display;
    // Store for clipboard
    serviceModeCenter.dataset.copyText = coordText;
  }

  function copyCenterToClipboard() {
    if (!serviceMode || !map) return;
    const text = serviceModeCenter.dataset.copyText || '';
    if (!text) return;

    navigator.clipboard.writeText(text).then(() => {
      // Flash the hint to indicate copy success
      const hint = document.getElementById('service-mode-hint');
      const original = hint.textContent;
      hint.textContent = 'Copied!';
      hint.style.fontWeight = 'bold';
      setTimeout(() => {
        hint.textContent = original;
        hint.style.fontWeight = 'normal';
      }, 1500);
    }).catch(() => {
      // Fallback: show alert if clipboard fails
      alert('Coordinates: ' + text);
    });
  }

  function enableServiceMode() {
    serviceMode = true;
    serviceModeOverlay.style.display = 'block';

    // Initial center update
    updateServiceModeCenter();

    // Listen for map events - use 'postrender' for real-time updates during pan/zoom
    map.on('postrender', updateServiceModeCenter);
    map.on('click', copyCenterToClipboard);
  }

  function disableServiceMode() {
    serviceMode = false;
    serviceModeOverlay.style.display = 'none';

    // Remove listeners
    map.un('postrender', updateServiceModeCenter);
    map.un('click', copyCenterToClipboard);
  }

  function checkForServiceModeActivation() {
    const now = Date.now();
    // Remove clicks older than 1.5 seconds
    infoClickTimes = infoClickTimes.filter(t => now - t < 1500);
    infoClickTimes.push(now);

    // If 4 clicks within 1.5 seconds, toggle service mode
    if (infoClickTimes.length >= 4) {
      infoClickTimes = [];
      if (serviceMode) {
        disableServiceMode();
      } else {
        enableServiceMode();
      }
      return true; // Prevent normal info overlay
    }
    return false;
  }

  infoIcon.addEventListener('click', () => {
    if (!checkForServiceModeActivation()) {
      infoOverlay.style.display = 'block';
    }
  });

  if (serviceModeClose) {
    serviceModeClose.addEventListener('click', disableServiceMode);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (serviceMode) {
        disableServiceMode();
      } else if (infoOverlay.style.display === 'block') {
        infoOverlay.style.display = 'none';
      }
    }
  });

  // =====================
// Boot
// =====================
(async function boot() {
  // NOTE: Park switching UI will come later; for now we load the active park's servers list.
  const primaryUrl = getServersUrl(currentParkId);
  const fallbackUrl = getServersUrl('wdw');

  try {
    let res = await fetch(primaryUrl, { cache: 'no-store' });
    if (!res.ok) {
      // If the park file isn't present yet, fall back to WDW so the app still starts.
      res = await fetch(fallbackUrl, { cache: 'no-store' });
    }
    if (!res.ok) throw new Error(`${res.status}`);

    serverOptions = await res.json();
    currentCode = serverOptions[serverOptions.length - 1].code;
    lastTwoDates = [currentCode, null];

    initMap();
    enableDoubleTapHoldZoom();
    updateDateUI();
    updateTdrButtons();

    // Expose bridge
    window.WDWMX.ol = ol;
    window.WDWMX.getMap = () => map;
    window.WDWMX.getCurrentCode = () => currentCode;
    window.WDWMX.getRightCode = () => rightCode;
    window.WDWMX.getCompareMode = () => compareMode;
    window.WDWMX.getLabelForCode = (code) => getLabelForCode(code);
    window.WDWMX.setSingleDate = (code) => setSingleDate(code);
    window.WDWMX.getServers = () => serverOptions;
    window.WDWMX.getServersUrl = (parkId) => getServersUrl(parkId);
    window.WDWMX.getParkId = () => currentParkId;
    window.WDWMX.getPark = () => getCurrentPark();
    window.WDWMX.getParks = () => Object.values(PARKS).map(p => ({ parkId: p.parkId, name: p.name }));

  } catch (err) {
    alert('Failed to load servers.json: ' + err);
  }
})();

})();
