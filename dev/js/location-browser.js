/* global WDWMX */
/*
 * Location Browser (dev mockup)
 * Categorized, searchable list of park locations.
 * Desktop: left side panel (map stays interactive).
 * Mobile: bottom sheet with half/full detents; picking a location dismisses.
 *
 * Reads park config "locationGroups" (array of { name, expanded?, locations[] });
 * falls back to a single group built from the flat "locations" array.
 */
(function () {
  'use strict';

  const MOBILE_QUERY = window.matchMedia('(max-width: 600px)');

  const browserEl = document.getElementById('locbrowser');
  const backdropEl = document.getElementById('locbrowser-backdrop');
  const handleEl = document.getElementById('locbrowser-handle');
  const titleEl = document.getElementById('locbrowser-title');
  const closeBtn = document.getElementById('locbrowser-close');
  const searchEl = document.getElementById('locbrowser-search');
  const listEl = document.getElementById('locbrowser-list');
  const emptyEl = document.getElementById('locbrowser-empty');

  if (!browserEl || !listEl) return;

  let isOpen = false;
  let currentItemBtn = null;

  function isMobile() {
    return MOBILE_QUERY.matches;
  }

  // =====================
  // Open / close
  // =====================
  function openBrowser() {
    isOpen = true;
    browserEl.classList.add('open');
    browserEl.classList.remove('tall');
    if (backdropEl) backdropEl.classList.add('open');
    document.body.classList.add('locbrowser-open');
  }

  function closeBrowser() {
    isOpen = false;
    browserEl.classList.remove('open', 'tall', 'dragging');
    browserEl.style.height = '';
    if (backdropEl) backdropEl.classList.remove('open');
    document.body.classList.remove('locbrowser-open');
    if (searchEl) {
      searchEl.value = '';
      applyFilter('');
      searchEl.blur();
    }
  }

  function toggleBrowser() {
    if (isOpen) closeBrowser();
    else openBrowser();
  }

  // =====================
  // Fly to a location (same width-based extent fit as the dock)
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

  // =====================
  // Build the list from park config
  // =====================
  function getGroups(park) {
    if (Array.isArray(park.locationGroups) && park.locationGroups.length) {
      return park.locationGroups;
    }
    // Fallback: single group from the flat locations array
    if (Array.isArray(park.locations) && park.locations.length) {
      return [{ name: 'Locations', expanded: true, locations: park.locations }];
    }
    return [];
  }

  function buildList(park) {
    listEl.innerHTML = '';
    if (titleEl) titleEl.textContent = 'Explore ' + (park.name || 'the resort');

    const groups = getGroups(park);

    groups.forEach((group) => {
      const groupEl = document.createElement('div');
      groupEl.className = 'locgroup' + (group.expanded ? ' expanded' : '');

      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'locgroup-header';
      header.innerHTML =
        '<span>' + group.name +
        ' <span class="locgroup-count">(' + group.locations.length + ')</span></span>' +
        '<svg class="locgroup-chevron" viewBox="0 0 24 24" width="14" height="14">' +
        '<polyline points="9,6 15,12 9,18" fill="none" stroke="currentColor" stroke-width="2.5" ' +
        'stroke-linecap="round" stroke-linejoin="round"/></svg>';
      header.addEventListener('click', () => {
        groupEl.classList.toggle('expanded');
      });
      groupEl.appendChild(header);

      const itemsEl = document.createElement('div');
      itemsEl.className = 'locgroup-items';

      group.locations.forEach((loc) => {
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

        btn.addEventListener('click', () => {
          if (currentItemBtn) currentItemBtn.classList.remove('current');
          btn.classList.add('current');
          currentItemBtn = btn;

          flyTo(loc);
          // Mobile: dismiss so the user watches the fly-to.
          // Desktop: stay open for browsing.
          if (isMobile()) closeBrowser();
        });

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

      // Searching auto-expands matching groups; clearing restores default state
      if (q && groupHasMatch) {
        groupEl.classList.add('expanded');
        groupEl.dataset.autoExpanded = '1';
      } else if (!q && groupEl.dataset.autoExpanded) {
        delete groupEl.dataset.autoExpanded;
        groupEl.classList.remove('expanded');
        // Restore groups that are expanded by default
        if (groupEl.dataset.defaultExpanded === '1') groupEl.classList.add('expanded');
      }
    });

    if (emptyEl) emptyEl.style.display = anyVisible ? 'none' : 'block';
  }

  // =====================
  // Mobile sheet dragging (half <-> full <-> dismiss)
  // =====================
  function enableSheetDrag() {
    if (!handleEl) return;

    let startY = 0;
    let startHeight = 0;

    function onMove(e) {
      const y = e.touches ? e.touches[0].clientY : e.clientY;
      const dy = startY - y; // positive = dragging up
      const newH = Math.min(window.innerHeight * 0.92, Math.max(120, startHeight + dy));
      browserEl.style.height = newH + 'px';
      e.preventDefault();
    }

    function onEnd(e) {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);

      browserEl.classList.remove('dragging');
      const h = browserEl.getBoundingClientRect().height;
      const vh = window.innerHeight;
      browserEl.style.height = '';

      // Snap: below 30% dismisses, above 70% goes tall, otherwise half
      if (h < vh * 0.3) {
        closeBrowser();
      } else if (h > vh * 0.7) {
        browserEl.classList.add('tall');
      } else {
        browserEl.classList.remove('tall');
      }
    }

    function onStart(e) {
      if (!isMobile() || !isOpen) return;
      startY = e.touches ? e.touches[0].clientY : e.clientY;
      startHeight = browserEl.getBoundingClientRect().height;
      browserEl.classList.add('dragging');

      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onEnd);
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
    }

    handleEl.addEventListener('touchstart', onStart, { passive: true });
    handleEl.addEventListener('mousedown', onStart);
  }

  // =====================
  // Dock trigger button
  // =====================
  function addDockButton() {
    const dock = document.getElementById('location-dock');
    if (!dock || document.getElementById('locbrowser-open')) return;

    const btn = document.createElement('button');
    btn.id = 'locbrowser-open';
    btn.title = 'All places';
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="3" y="3" width="7" height="7" rx="1.5"/>' +
      '<rect x="14" y="3" width="7" height="7" rx="1.5"/>' +
      '<rect x="3" y="14" width="7" height="7" rx="1.5"/>' +
      '<rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
    btn.addEventListener('click', toggleBrowser);
    dock.appendChild(btn);
  }

  // =====================
  // Wiring
  // =====================
  if (closeBtn) closeBtn.addEventListener('click', closeBrowser);
  if (backdropEl) backdropEl.addEventListener('click', closeBrowser);

  if (searchEl) {
    searchEl.addEventListener('input', () => applyFilter(searchEl.value));
    // Focusing search on mobile expands the sheet so the keyboard doesn't cover the list
    searchEl.addEventListener('focus', () => {
      if (isMobile()) browserEl.classList.add('tall');
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) closeBrowser();
  });

  enableSheetDrag();

  // Wait for core.js boot to finish (dock populated, park config loaded)
  const bootPoll = setInterval(() => {
    const park = WDWMX.getPark && WDWMX.getPark();
    const dock = document.getElementById('location-dock');
    if (park && dock && dock.children.length > 0) {
      clearInterval(bootPoll);
      buildList(park);
      // Remember which groups default to expanded (for search-clear restore)
      listEl.querySelectorAll('.locgroup').forEach((g) => {
        if (g.classList.contains('expanded')) g.dataset.defaultExpanded = '1';
      });
      addDockButton();
    }
  }, 100);

  // Give up after 15s (e.g. boot failed); avoids polling forever
  setTimeout(() => clearInterval(bootPoll), 15000);
})();
