/* global WDWMX */
/*
 * Location Pill + Spotlight-style Browser (dev mockup)
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
      const halfW = width / 2;
      const extentLonLat = [lon - halfW, lat - halfW, lon + halfW, lat + halfW];
      const extent3857 = ol.proj.transformExtent(extentLonLat, 'EPSG:4326', 'EPSG:3857');
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
      const groupEl = document.createElement('div');
      groupEl.className = 'locgroup' + (group.expanded ? ' expanded' : '');
      if (group.expanded) groupEl.dataset.defaultExpanded = '1';

      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'locgroup-header';
      header.innerHTML =
        '<span>' + group.name +
        ' <span class="locgroup-count">(' + group.locations.length + ')</span></span>' +
        '<svg class="locgroup-chevron" viewBox="0 0 24 24" width="13" height="13">' +
        '<polyline points="9,6 15,12 9,18" fill="none" stroke="currentColor" stroke-width="2.5" ' +
        'stroke-linecap="round" stroke-linejoin="round"/></svg>';
      header.addEventListener('click', () => {
        groupEl.classList.toggle('expanded');
      });
      groupEl.appendChild(header);

      const itemsEl = document.createElement('div');
      itemsEl.className = 'locgroup-items';

      group.locations.forEach((loc) => {
        allLocations.push(loc);

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

  function updatePillLabel() {
    const ol = WDWMX.ol;
    const map = WDWMX.getMap && WDWMX.getMap();
    if (!ol || !map || !allLocations.length) return;

    const center = ol.proj.toLonLat(map.getView().getCenter());
    const cosLat = Math.cos(center[1] * Math.PI / 180);

    let best = null;
    let bestDistSq = Infinity;
    for (const loc of allLocations) {
      if (!Array.isArray(loc.coords)) continue;
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
  const datePillLabel = document.getElementById('date-pill-label');
  const dateBrowserEl = document.getElementById('datebrowser');
  const dateBackdropEl = document.getElementById('datebrowser-backdrop');
  const dateCloseBtn = document.getElementById('datebrowser-close');
  const dateListEl = document.getElementById('datebrowser-list');

  if (!datePillEl || !dateBrowserEl || !dateListEl) return;

  let isOpen = false;
  let currentDateBtn = null;
  let kbdFocusBtn = null;

  function openDateBrowser() {
    // Close location browser if open
    document.body.classList.remove('locbrowser-open');
    const locPanel = document.getElementById('locbrowser');
    const locBackdrop = document.getElementById('locbrowser-backdrop');
    if (locPanel) locPanel.classList.remove('open');
    if (locBackdrop) locBackdrop.classList.remove('open');

    isOpen = true;
    dateBrowserEl.classList.add('open');
    dateBackdropEl.classList.add('open');
    document.body.classList.add('datebrowser-open');
    // Scroll the current selection into view
    setTimeout(() => {
      if (currentDateBtn) {
        currentDateBtn.scrollIntoView({ block: 'center' });
      }
    }, 50);
  }

  function closeDateBrowser() {
    isOpen = false;
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
    return Array.from(dateListEl.querySelectorAll('.dateitem'));
  }

  function moveKbdFocus(delta) {
    const items = visibleItems();
    if (!items.length) return;
    const idx = kbdFocusBtn ? items.indexOf(kbdFocusBtn) : -1;
    const next = Math.max(0, Math.min(items.length - 1, idx + delta));
    setKbdFocus(items[next]);
  }

  function buildDateList() {
    dateListEl.innerHTML = '';

    const servers = WDWMX.getServers ? WDWMX.getServers() : [];
    const currentCode = WDWMX.getCurrentCode ? WDWMX.getCurrentCode() : null;
    const getLabelForCode = WDWMX.getLabelForCode || ((c) => c);

    // Reverse so newest is at the top
    const reversed = servers.slice().reverse();

    reversed.forEach((server) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dateitem';
      btn.dataset.code = server.code;
      btn.textContent = server.label || server.code;

      if (server.code === currentCode) {
        btn.classList.add('current');
        currentDateBtn = btn;
        datePillLabel.textContent = server.label || server.code;
      }

      btn.addEventListener('click', () => {
        if (WDWMX.setSingleDate) {
          WDWMX.setSingleDate(server.code);
        }
        datePillLabel.textContent = server.label || server.code;

        // Update current styling
        if (currentDateBtn) currentDateBtn.classList.remove('current');
        btn.classList.add('current');
        currentDateBtn = btn;

        closeDateBrowser();
      });

      dateListEl.appendChild(btn);
    });
  }

  // Wiring
  datePillEl.addEventListener('click', () => {
    if (isOpen) closeDateBrowser();
    else openDateBrowser();
  });

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
    }
  }, 100);

  setTimeout(() => clearInterval(bootPoll), 15000);
})();
