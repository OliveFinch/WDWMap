/* global WDWMX */
/*
 * Location Pill + Spotlight-style Browser
 *
 * The pill (bottom center, replaces the dock) shows the current location -
 * the nearest known place to the map center - and opens a frosted-glass,
 * search-first panel when tapped. Picking a place flies the map there and
 * closes the panel. Enter selects the first result; arrow keys navigate.
 *
 * Reads park config "locationGroups" (array of { name, expanded?, locations[] });
 * falls back to a single group built from the flat "locations" array.
 */
(function () {
  'use strict';

  const pillEl = document.getElementById('loc-pill');
  const pillLabel = document.getElementById('loc-pill-label');
  const browserEl = document.getElementById('locbrowser');
  const backdropEl = document.getElementById('locbrowser-backdrop');
  const closeBtn = document.getElementById('locbrowser-close');
  const searchEl = document.getElementById('locbrowser-search');
  const listEl = document.getElementById('locbrowser-list');
  const emptyEl = document.getElementById('locbrowser-empty');

  if (!pillEl || !browserEl || !listEl) return;

  let isOpen = false;
  let allLocations = [];   // flat list for nearest-place lookup
  let parkName = '';
  let currentItemBtn = null;
  let kbdFocusBtn = null;

  // =====================
  // Open / close
  // =====================
  function openBrowser() {
    // Close date browser if open
    document.body.classList.remove('datebrowser-open');
    const datePanel = document.getElementById('datebrowser');
    const dateBackdrop = document.getElementById('datebrowser-backdrop');
    if (datePanel) datePanel.classList.remove('open');
    if (dateBackdrop) dateBackdrop.classList.remove('open');

    isOpen = true;
    browserEl.classList.add('open');
    backdropEl.classList.add('open');
    document.body.classList.add('locbrowser-open');
    // Slight delay so the open transition isn't janked by the keyboard
    setTimeout(() => searchEl.focus(), 80);
  }

  function closeBrowser() {
    isOpen = false;
    browserEl.classList.remove('open');
    backdropEl.classList.remove('open');
    document.body.classList.remove('locbrowser-open');
    searchEl.value = '';
    applyFilter('');
    setKbdFocus(null);
    searchEl.blur();
  }

  // =====================
  // Fly to a location (same width-based extent fit as the old dock)
  // =====================
  function flyTo(loc) {
    const ol = WDWMX.ol;
    const map = WDWMX.getMap && WDWMX.getMap();
    if (!ol || !map || !Array.isArray(loc.coords)) return;

    const lon = loc.coords[0];
    const lat = loc.coords[1];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

    const view = map.getView();
    const target = ol.proj.fromLonLat([lon, lat]);
    const animateOpts = { center: target, duration: 700 };

    const width = parseFloat(loc.width);
    if (Number.isFinite(width) && width > 0) {
      // Fit the "view square": width degrees of longitude as a true
      // projected square, so the whole region is visible on any device
      // (landscape shows excess left/right, portrait excess top/bottom)
      const halfMeters = (width * 111319.49079327358) / 2;
      const extent3857 = [
        target[0] - halfMeters, target[1] - halfMeters,
        target[0] + halfMeters, target[1] + halfMeters
      ];
      const resolution = view.getResolutionForExtent(extent3857, map.getSize());
      animateOpts.zoom = view.getZoomForResolution(resolution);
    } else {
      animateOpts.zoom = 16;
    }

    if (loc.rotation !== undefined && Number.isFinite(parseFloat(loc.rotation))) {
      animateOpts.rotation = parseFloat(loc.rotation) * (Math.PI / 180);
    }

    view.animate(animateOpts);
  }

  function pickLocation(loc, btn) {
    if (currentItemBtn) currentItemBtn.classList.remove('current');
    btn.classList.add('current');
    currentItemBtn = btn;

    pillLabel.textContent = loc.alt || 'Location';
    flyTo(loc);
    closeBrowser();
  }

  // =====================
  // Build the list from park config
  // =====================
  function getGroups(park) {
    if (Array.isArray(park.locationGroups) && park.locationGroups.length) {
      return park.locationGroups;
    }
    if (Array.isArray(park.locations) && park.locations.length) {
      return [{ name: 'Locations', expanded: true, locations: park.locations }];
    }
    return [];
  }

  function buildList(park) {
    listEl.innerHTML = '';
    parkName = park.name || 'Explore places';
    pillLabel.textContent = parkName;
    searchEl.placeholder = 'Search ' + parkName + '…';

    const groups = getGroups(park);
    allLocations = [];

    groups.forEach((group) => {
      // Locations with "hidden": true stay out of the browse/search list but
      // are still tracked for the hover ("you are here") label
      const visibleLocs = group.locations.filter((loc) => !loc.hidden);
      group.locations.forEach((loc) => allLocations.push(loc));
      if (!visibleLocs.length) return;

      const groupEl = document.createElement('div');
      groupEl.className = 'locgroup' + (group.expanded ? ' expanded' : '');
      if (group.expanded) groupEl.dataset.defaultExpanded = '1';

      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'locgroup-header';
      header.innerHTML =
        '<span>' + group.name +
        ' <span class="locgroup-count">(' + visibleLocs.length + ')</span></span>' +
        '<svg class="locgroup-chevron" viewBox="0 0 24 24" width="13" height="13">' +
        '<polyline points="9,6 15,12 9,18" fill="none" stroke="currentColor" stroke-width="2.5" ' +
        'stroke-linecap="round" stroke-linejoin="round"/></svg>';
      header.addEventListener('click', () => {
        groupEl.classList.toggle('expanded');
      });
      groupEl.appendChild(header);

      const itemsEl = document.createElement('div');
      itemsEl.className = 'locgroup-items';

      visibleLocs.forEach((loc) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'locitem';
        btn.dataset.name = (loc.alt || '').toLowerCase();

        const img = document.createElement('img');
        img.src = loc.icon || 'icons/locations/marker.svg';
        img.alt = '';
        img.onerror = function () { this.src = 'icons/locations/marker.svg'; };
        btn.appendChild(img);

        const name = document.createElement('span');
        name.className = 'locitem-name';
        name.textContent = loc.alt || 'Location';
        btn.appendChild(name);

        btn.addEventListener('click', () => pickLocation(loc, btn));

        itemsEl.appendChild(btn);
      });

      groupEl.appendChild(itemsEl);
      listEl.appendChild(groupEl);
    });
  }

  // =====================
  // Search filter
  // =====================
  function applyFilter(query) {
    const q = query.trim().toLowerCase();
    let anyVisible = false;

    listEl.querySelectorAll('.locgroup').forEach((groupEl) => {
      let groupHasMatch = false;

      groupEl.querySelectorAll('.locitem').forEach((item) => {
        const match = !q || (item.dataset.name || '').includes(q);
        item.style.display = match ? '' : 'none';
        if (match) groupHasMatch = true;
      });

      groupEl.style.display = groupHasMatch ? '' : 'none';
      if (groupHasMatch) anyVisible = true;

      // Searching auto-expands matching groups; clearing restores defaults
      if (q && groupHasMatch) {
        groupEl.classList.add('expanded');
        groupEl.dataset.autoExpanded = '1';
      } else if (!q && groupEl.dataset.autoExpanded) {
        delete groupEl.dataset.autoExpanded;
        groupEl.classList.toggle('expanded', groupEl.dataset.defaultExpanded === '1');
      }
    });

    emptyEl.style.display = anyVisible ? 'none' : 'block';
    setKbdFocus(null);
  }

  // =====================
  // Keyboard navigation (Spotlight-style)
  // =====================
  function visibleItems() {
    return Array.from(listEl.querySelectorAll('.locitem')).filter(
      (el) => el.style.display !== 'none' &&
              el.closest('.locgroup').style.display !== 'none' &&
              el.closest('.locgroup').classList.contains('expanded')
    );
  }

  function setKbdFocus(btn) {
    if (kbdFocusBtn) kbdFocusBtn.classList.remove('kbd-focus');
    kbdFocusBtn = btn;
    if (kbdFocusBtn) {
      kbdFocusBtn.classList.add('kbd-focus');
      kbdFocusBtn.scrollIntoView({ block: 'nearest' });
    }
  }

  function moveKbdFocus(delta) {
    const items = visibleItems();
    if (!items.length) return;
    const idx = kbdFocusBtn ? items.indexOf(kbdFocusBtn) : -1;
    const next = Math.max(0, Math.min(items.length - 1, idx + delta));
    setKbdFocus(items[next]);
  }

  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveKbdFocus(+1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveKbdFocus(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const target = kbdFocusBtn || visibleItems()[0];
      if (target) target.click();
    }
  });

  // =====================
  // "Current location" pill label - nearest known place to map center
  // =====================
  function lonLatDistSq(a, b, cosLat) {
    const dx = (a[0] - b[0]) * cosLat;
    const dy = a[1] - b[1];
    return dx * dx + dy * dy;
  }

  // Ray-casting point-in-polygon; poly is [[lon, lat], ...]
  function pointInPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const intersects = ((yi > pt[1]) !== (yj > pt[1])) &&
        (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function hasArea(loc) {
    return Array.isArray(loc.area) && loc.area.length >= 3;
  }

  // Only resolve to a named place once the user is zoomed in this far;
  // when zoomed out the pill just shows the resort/park name
  const MIN_LABEL_ZOOM = 16;

  function updatePillLabel() {
    const ol = WDWMX.ol;
    const map = WDWMX.getMap && WDWMX.getMap();
    if (!ol || !map || !allLocations.length) return;

    const zoom = map.getView().getZoom();
    if (!Number.isFinite(zoom) || zoom < MIN_LABEL_ZOOM) {
      pillLabel.textContent = parkName;
      pillEl.classList.add('fallback');
      return;
    }

    const center = ol.proj.toLonLat(map.getView().getCenter());
    const cosLat = Math.cos(center[1] * Math.PI / 180);

    // Locations with an "area" polygon show their name only while the
    // center is inside it; if areas overlap, the nearest coords wins
    let areaBest = null;
    let areaBestDistSq = Infinity;
    for (const loc of allLocations) {
      if (!hasArea(loc) || !pointInPolygon(center, loc.area)) continue;
      const anchor = Array.isArray(loc.coords) ? loc.coords : loc.area[0];
      const d = lonLatDistSq(center, anchor, cosLat);
      if (d < areaBestDistSq) { areaBestDistSq = d; areaBest = loc; }
    }
    if (areaBest) {
      pillLabel.textContent = areaBest.alt || parkName;
      pillEl.classList.remove('fallback');
      return;
    }

    // Radius fallback for locations without an area polygon (their
    // coords + width are the fly-to starting point, not the hover zone)
    let best = null;
    let bestDistSq = Infinity;
    for (const loc of allLocations) {
      if (!Array.isArray(loc.coords) || hasArea(loc)) continue;
      const d = lonLatDistSq(center, loc.coords, cosLat);
      if (d < bestDistSq) { bestDistSq = d; best = loc; }
    }

    // "At" a place if center is within ~70% of its fit-width (min ~150m)
    if (best) {
      const radius = Math.max((parseFloat(best.width) || 0.004) * 0.7, 0.0015);
      if (bestDistSq <= radius * radius) {
        pillLabel.textContent = best.alt || parkName;
        pillEl.classList.remove('fallback');
        return;
      }
    }
    pillLabel.textContent = parkName;
    pillEl.classList.add('fallback');
  }

  // =====================
  // Wiring
  // =====================
  pillEl.addEventListener('click', openBrowser);
  closeBtn.addEventListener('click', closeBrowser);
  backdropEl.addEventListener('click', closeBrowser);
  searchEl.addEventListener('input', () => applyFilter(searchEl.value));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) closeBrowser();
  });

  // Wait for core.js boot to finish (park config loaded, map created)
  const bootPoll = setInterval(() => {
    const park = WDWMX.getPark && WDWMX.getPark();
    const map = WDWMX.getMap && WDWMX.getMap();
    if (park && map) {
      clearInterval(bootPoll);
      buildList(park);
      updatePillLabel();
      map.on('moveend', updatePillLabel);
    }
  }, 100);

  // Give up after 15s (e.g. boot failed); avoids polling forever
  setTimeout(() => clearInterval(bootPoll), 15000);
})();

/* =========================================================
   Date Browser — Spotlight-style date selector
   ========================================================= */
(function () {
  'use strict';

  const datePillEl = document.getElementById('date-pill');
  const datePillMain = document.getElementById('date-pill-main');
  const datePillPrev = document.getElementById('date-pill-prev');
  const datePillNext = document.getElementById('date-pill-next');
  const datePillLabel = document.getElementById('date-pill-label');
  const datePillLeft = document.getElementById('date-pill-left');
  const datePillLeftLabel = document.getElementById('date-pill-left-label');
  const datePillRight = document.getElementById('date-pill-right');
  const datePillRightLabel = document.getElementById('date-pill-right-label');
  const datePillCmpPrev = document.getElementById('date-pill-cmp-prev');
  const datePillCmpNext = document.getElementById('date-pill-cmp-next');
  const dateBrowserEl = document.getElementById('datebrowser');
  const dateBackdropEl = document.getElementById('datebrowser-backdrop');
  const dateCloseBtn = document.getElementById('datebrowser-close');
  const dateBrowserTitle = document.getElementById('datebrowser-title');
  const dateListEl = document.getElementById('datebrowser-list');

  if (!datePillMain || !dateBrowserEl || !dateListEl) return;

  let isOpen = false;
  let currentDateBtn = null;
  let kbdFocusBtn = null;
  let pickingSide = null; // null, 'left', or 'right' (for compare mode)

  function openDateBrowser(side) {
    // Close location browser if open
    document.body.classList.remove('locbrowser-open');
    const locPanel = document.getElementById('locbrowser');
    const locBackdrop = document.getElementById('locbrowser-backdrop');
    if (locPanel) locPanel.classList.remove('open');
    if (locBackdrop) locBackdrop.classList.remove('open');

    pickingSide = side || null;
    isOpen = true;
    dateBrowserEl.classList.add('open');
    dateBackdropEl.classList.add('open');
    document.body.classList.add('datebrowser-open');

    // Update title for compare mode
    if (pickingSide === 'left') {
      dateBrowserTitle.textContent = 'Select Older Date';
      buildDateListForCompare('left');
    } else if (pickingSide === 'right') {
      dateBrowserTitle.textContent = 'Select Newer Date';
      buildDateListForCompare('right');
    } else {
      dateBrowserTitle.textContent = 'Select Date';
      buildDateList();
    }

    // Scroll the current selection into view
    setTimeout(() => {
      if (currentDateBtn) {
        currentDateBtn.scrollIntoView({ block: 'center' });
      }
    }, 50);
  }

  function closeDateBrowser() {
    isOpen = false;
    pickingSide = null;
    dateBrowserEl.classList.remove('open');
    dateBackdropEl.classList.remove('open');
    document.body.classList.remove('datebrowser-open');
    setKbdFocus(null);
  }

  function setKbdFocus(btn) {
    if (kbdFocusBtn) kbdFocusBtn.classList.remove('kbd-focus');
    kbdFocusBtn = btn;
    if (kbdFocusBtn) {
      kbdFocusBtn.classList.add('kbd-focus');
      kbdFocusBtn.scrollIntoView({ block: 'nearest' });
    }
  }

  function visibleItems() {
    return Array.from(dateListEl.querySelectorAll('.dateitem:not([style*="display: none"])'));
  }

  function moveKbdFocus(delta) {
    const items = visibleItems();
    if (!items.length) return;
    const idx = kbdFocusBtn ? items.indexOf(kbdFocusBtn) : -1;
    const next = Math.max(0, Math.min(items.length - 1, idx + delta));
    setKbdFocus(items[next]);
  }

  // Mode-agnostic helpers: items are { key, label } where key is a Disney
  // map code or a satellite esri_id, depending on the active view.
  function getNavList() {
    return WDWMX.getNavList ? WDWMX.getNavList() : [];
  }

  function labelForKey(key) {
    const item = getNavList().find((o) => o.key === key);
    return item ? item.label : '';
  }

  function buildDateList() {
    dateListEl.innerHTML = '';
    currentDateBtn = null;

    const navList = getNavList();
    const currentKey = WDWMX.getNavKey ? WDWMX.getNavKey('current') : null;

    // Reverse so newest is at the top
    const reversed = navList.slice().reverse();

    reversed.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dateitem';
      btn.dataset.code = item.key;
      btn.textContent = item.label || item.key;

      if (item.key === currentKey) {
        btn.classList.add('current');
        currentDateBtn = btn;
      }

      btn.addEventListener('click', () => {
        if (WDWMX.setSingleNav) WDWMX.setSingleNav(item.key);
        closeDateBrowser();
        setTimeout(syncFromCore, 80);
      });

      dateListEl.appendChild(btn);
    });
  }

  function buildDateListForCompare(side) {
    dateListEl.innerHTML = '';
    currentDateBtn = null;

    const navList = getNavList();
    const leftKey = WDWMX.getNavKey ? WDWMX.getNavKey('left') : null;
    const rightKey = WDWMX.getNavKey ? WDWMX.getNavKey('right') : null;

    const leftIdx = navList.findIndex((o) => o.key === leftKey);
    const rightIdx = navList.findIndex((o) => o.key === rightKey);

    // Reverse so newest is at the top
    const reversed = navList.slice().reverse();

    reversed.forEach((item, revIdx) => {
      const itemIdx = navList.length - 1 - revIdx;

      // Filter: left must stay older (lower index) than right, and vice versa
      if (side === 'left' && rightIdx >= 0 && itemIdx >= rightIdx) return;
      if (side === 'right' && leftIdx >= 0 && itemIdx <= leftIdx) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dateitem';
      btn.dataset.code = item.key;
      btn.textContent = item.label || item.key;

      const isCurrentSelection = (side === 'left' && item.key === leftKey) ||
                                 (side === 'right' && item.key === rightKey);
      if (isCurrentSelection) {
        btn.classList.add('current');
        currentDateBtn = btn;
      }

      btn.addEventListener('click', () => {
        if (WDWMX.setCompareNav) WDWMX.setCompareNav(side, item.key);
        closeDateBrowser();
        setTimeout(syncFromCore, 80);
      });

      dateListEl.appendChild(btn);
    });
  }

  // Keep the pill in sync with the app's date state
  function syncFromCore() {
    const compareMode = WDWMX.getCompareMode ? WDWMX.getCompareMode() : false;

    // Toggle compare mode class on the pill
    datePillEl.classList.toggle('compare-mode', compareMode);

    if (compareMode) {
      const leftKey = WDWMX.getNavKey ? WDWMX.getNavKey('left') : null;
      const rightKey = WDWMX.getNavKey ? WDWMX.getNavKey('right') : null;
      datePillLeftLabel.textContent = (leftKey && labelForKey(leftKey)) || 'Older';
      datePillRightLabel.textContent = (rightKey && labelForKey(rightKey)) || 'Newer';

      // Mirror disabled state for compare mode arrows
      const corePrev = document.getElementById('date-prev-btn');
      const coreNext = document.getElementById('date-next-btn');
      if (corePrev && datePillCmpPrev) datePillCmpPrev.classList.toggle('disabled', corePrev.classList.contains('disabled'));
      if (coreNext && datePillCmpNext) datePillCmpNext.classList.toggle('disabled', coreNext.classList.contains('disabled'));
    } else {
      const currentKey = WDWMX.getNavKey ? WDWMX.getNavKey('current') : null;
      const label = currentKey && labelForKey(currentKey);
      if (label) datePillLabel.textContent = label;

      // Update highlighted item in the list
      if (currentDateBtn) currentDateBtn.classList.remove('current');
      currentDateBtn = dateListEl.querySelector(`.dateitem[data-code="${currentKey}"]`);
      if (currentDateBtn) currentDateBtn.classList.add('current');

      // Mirror the disabled state of core's hidden nav arrows
      const corePrev = document.getElementById('date-prev-btn');
      const coreNext = document.getElementById('date-next-btn');
      if (corePrev) datePillPrev.classList.toggle('disabled', corePrev.classList.contains('disabled'));
      if (coreNext) datePillNext.classList.toggle('disabled', coreNext.classList.contains('disabled'));
    }
  }

  // Wiring — Single date mode
  datePillMain.addEventListener('click', () => {
    if (isOpen) closeDateBrowser();
    else openDateBrowser(null);
  });

  // Arrows proxy to core.js's existing (hidden) nav buttons
  datePillPrev.addEventListener('click', () => {
    const coreBtn = document.getElementById('date-prev-btn');
    if (coreBtn) coreBtn.click();
    setTimeout(syncFromCore, 50);
  });
  datePillNext.addEventListener('click', () => {
    const coreBtn = document.getElementById('date-next-btn');
    if (coreBtn) coreBtn.click();
    setTimeout(syncFromCore, 50);
  });

  // Wiring — Compare mode
  datePillLeft.addEventListener('click', () => {
    if (isOpen && pickingSide === 'left') closeDateBrowser();
    else openDateBrowser('left');
  });
  datePillRight.addEventListener('click', () => {
    if (isOpen && pickingSide === 'right') closeDateBrowser();
    else openDateBrowser('right');
  });

  // Compare mode arrows — proxy to core.js nav buttons (shifts both dates together)
  if (datePillCmpPrev) {
    datePillCmpPrev.addEventListener('click', () => {
      const coreBtn = document.getElementById('date-prev-btn');
      if (coreBtn) coreBtn.click();
      setTimeout(syncFromCore, 50);
    });
  }
  if (datePillCmpNext) {
    datePillCmpNext.addEventListener('click', () => {
      const coreBtn = document.getElementById('date-next-btn');
      if (coreBtn) coreBtn.click();
      setTimeout(syncFromCore, 50);
    });
  }

  dateCloseBtn.addEventListener('click', closeDateBrowser);
  dateBackdropEl.addEventListener('click', closeDateBrowser);

  document.addEventListener('keydown', (e) => {
    if (!isOpen) return;
    if (e.key === 'Escape') { closeDateBrowser(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); moveKbdFocus(+1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveKbdFocus(-1); }
    else if (e.key === 'Enter' && kbdFocusBtn) { e.preventDefault(); kbdFocusBtn.click(); }
  });

  // Wait for core.js boot
  const bootPoll = setInterval(() => {
    const servers = WDWMX.getServers && WDWMX.getServers();
    if (servers && servers.length) {
      clearInterval(bootPoll);
      buildDateList();
      syncFromCore();

      // Watch core's date display for compare mode changes and date updates
      const currentDateDisplay = document.getElementById('current-date-display');
      if (currentDateDisplay && window.MutationObserver) {
        new MutationObserver(syncFromCore).observe(currentDateDisplay, {
          attributes: true,
          attributeFilter: ['class'],
          childList: true,
          characterData: true,
          subtree: true
        });
      }
    }
  }, 100);

  setTimeout(() => clearInterval(bootPoll), 15000);
})();
