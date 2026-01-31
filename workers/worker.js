// =====================
// TDR Configuration - UPDATE THESE WHEN EXPIRED
// =====================
const TDR_CONFIG = {
  // Base URL for TDR map tiles
  tileBaseUrl: 'https://contents-portal.tokyodisneyresort.jp/limited/map-image/20260122183830/daytime/',
  // Required User-Agent header
  userAgent: 'Disney Resort/3.10.9 (jp.tokyodisneyresort.portalapp; build:4; iOS 26.2.1) Alamofire/5.10.2',
  // CloudFront signed cookies (time-limited)
  cookies: {
    'CloudFront-Signature': 'cwTUHMSzbLVk8hGDDQKJRIdzeS9J4FTjvt8~A4kBUL9cyslMKXoEA9~M8OGDvnyZu6g8vjn6ssJ8DgrD35Njt2DJLN1KpV6k4PapQEe2Rpa-oWWfl6xAsu39QEF1wGRdvAcGh1QvP2DSq8wIij7101f7lye55iE~FCJBNShCh-ukO5jZkokgCkKWw7C9SHOnU6FLoXi4CC3yFAA65p-p2cYrSFk-o3PvaVEL8L2Hpa4kiJMnwiU6FQupYMCclgC3093LB32ow8od~2jGYKCop1a0dV7P84Hd9JmbCALE0JDLNrRrJNFzDyHSlrONobdrKzMcDjv8zvcpqrp4NUVUag__',
    'CloudFront-Key-Pair-Id': 'APKAIJUGP2GGEWDAPMTQ',
    'CloudFront-Policy': 'eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vY29udGVudHMtcG9ydGFsLnRva3lvZGlzbmV5cmVzb3J0LmpwLyoiLCJDb25kaXRpb24iOnsiRGF0ZUxlc3NUaGFuIjp7IkFXUzpFcG9jaFRpbWUiOjE3NzI0NDIzNzl9LCJJcEFkZHJlc3MiOnsiQVdTOlNvdXJjZUlwIjoiMC4wLjAuMC8wIn19fV19'
  }
};

function buildTdrCookieString() {
  return Object.entries(TDR_CONFIG.cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join(';');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // -------------------------
    // CORS
    // -------------------------
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    // -------------------------
    // Simple helpers
    // -------------------------
    const withCors = (res) => {
      const h = new Headers(res.headers);
      for (const [k, v] of Object.entries(cors)) h.set(k, v);
      return new Response(res.body, { status: res.status, headers: h });
    };

    // -------------------------
    // TDR Tile Proxy
    // GET /tdr-tiles/z{zoom}/{x}_{y}.jpg
    // -------------------------
    if (url.pathname.startsWith("/tdr-tiles/")) {
      const tilePath = url.pathname.replace(/^\/tdr-tiles\//, '');

      if (!tilePath) {
        return new Response('Invalid tile path', { status: 400, headers: cors });
      }

      const tileUrl = TDR_CONFIG.tileBaseUrl + tilePath;

      try {
        const tileResponse = await fetch(tileUrl, {
          method: 'GET',
          headers: {
            'User-Agent': TDR_CONFIG.userAgent,
            'Cookie': buildTdrCookieString(),
            'Accept': 'image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,ja;q=0.8',
            'Referer': 'https://www.tokyodisneyresort.jp/'
          }
        });

        if (!tileResponse.ok) {
          // Return empty response for missing tiles (404/403)
          if (tileResponse.status === 404 || tileResponse.status === 403) {
            return new Response(null, {
              status: 204,
              headers: { ...cors, 'Cache-Control': 'public, max-age=3600' }
            });
          }
          return new Response(`Tile fetch failed: ${tileResponse.status}`, {
            status: tileResponse.status,
            headers: cors
          });
        }

        const tileData = await tileResponse.arrayBuffer();

        return new Response(tileData, {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            ...cors,
            'Cache-Control': 'public, max-age=86400'
          }
        });

      } catch (error) {
        return new Response(`Proxy error: ${error.message}`, {
          status: 500,
          headers: cors
        });
      }
    }

    // -------------------------
    // Health
    // -------------------------
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true }, 200, cors);
    }

    // =========================================================
    // PUBLIC ENDPOINTS
    // =========================================================

    // 1) Public: per-map approved changes
    // GET /api/changes?serverId=...&mapVersion=...&parkId=...&limit=50
    if (url.pathname === "/api/changes" && request.method === "GET") {
      const serverId = url.searchParams.get("serverId");
      const mapVersion = url.searchParams.get("mapVersion");
      const parkId = url.searchParams.get("parkId") || "wdw";
      const limit = clampInt(url.searchParams.get("limit"), 1, 200, 50);

      if (!serverId || !mapVersion) {
        return json({ error: "serverId and mapVersion are required" }, 400, cors);
      }

      const stmt = env.DB.prepare(`
        SELECT
          id, server_id, map_version, park_id,
          lat, lng, zoom,
          bbox_west, bbox_south, bbox_east, bbox_north,
          category, description, display_name,
          status, admin_notes,
          created_at, updated_at, approved_at
        FROM change_reports
        WHERE server_id = ?
          AND map_version = ?
          AND park_id = ?
          AND status = 'approved'
        ORDER BY approved_at DESC, created_at DESC
        LIMIT ?
      `).bind(serverId, mapVersion, parkId, limit);

      const { results } = await stmt.all();
      return json({ results }, 200, cors);
    }

    // 1b) Public: approved changes feed filtered by park
    // GET /api/changes-feed?parkId=wdw&limit=200
    if (url.pathname === "/api/changes-feed" && request.method === "GET") {
      const parkId = url.searchParams.get("parkId") || "wdw";
      const limit = clampInt(url.searchParams.get("limit"), 1, 200, 200);

      const stmt = env.DB.prepare(`
        SELECT
          id, server_id, map_version, park_id,
          lat, lng, zoom,
          bbox_west, bbox_south, bbox_east, bbox_north,
          category, description, display_name,
          status, admin_notes,
          created_at, updated_at, approved_at
        FROM change_reports
        WHERE status = 'approved'
          AND park_id = ?
        ORDER BY approved_at DESC, created_at DESC
        LIMIT ?
      `).bind(parkId, limit);

      const { results } = await stmt.all();
      return json({ results }, 200, cors);
    }

    // 2) Public: submit a new report (always pending)
    // POST /api/reports
    if (url.pathname === "/api/reports" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400, cors);
      }

      const parkId = safeText(body.parkId || "wdw", 20);
      const serverId = safeText(body.serverId, 80);
      const mapVersion = safeText(body.mapVersion, 40);
      const description = safeText(body.description, 2000);
      const category = safeText(body.category || "general", 40);
      const displayName = safeText(body.displayName || "", 60);

      const lat = Number(body.lat);
      const lng = Number(body.lng);
      const zoom = Number(body.zoom);

      const bboxWest = body.bboxWest != null ? Number(body.bboxWest) : null;
      const bboxSouth = body.bboxSouth != null ? Number(body.bboxSouth) : null;
      const bboxEast = body.bboxEast != null ? Number(body.bboxEast) : null;
      const bboxNorth = body.bboxNorth != null ? Number(body.bboxNorth) : null;

      if (!serverId || !mapVersion || !description) {
        return json({ error: "serverId, mapVersion, and description are required" }, 400, cors);
      }
      if (![lat, lng, zoom].every((n) => Number.isFinite(n))) {
        return json({ error: "lat, lng, and zoom must be numbers" }, 400, cors);
      }
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return json({ error: "lat/lng out of range" }, 400, cors);
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await env.DB.prepare(`
        INSERT INTO change_reports (
          id, server_id, map_version, park_id,
          lat, lng, zoom,
          bbox_west, bbox_south, bbox_east, bbox_north,
          category, description, display_name,
          status, admin_notes,
          created_at, updated_at, approved_at
        ) VALUES (
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          'pending', NULL,
          ?, ?, NULL
        )
      `).bind(
        id, serverId, mapVersion, parkId,
        lat, lng, zoom,
        bboxWest, bboxSouth, bboxEast, bboxNorth,
        category, description, displayName || null,
        now, now
      ).run();

      return json({ id, parkId, status: "pending", createdAt: now }, 201, cors);
    }

    // =========================================================
    // ADMIN ENDPOINTS
    // =========================================================
    // Auth: Authorization: Bearer <ADMIN_TOKEN>
    if (url.pathname.startsWith("/api/admin/")) {
      if (!isAuthedAdmin(request, env)) {
        return json({ error: "Unauthorized" }, 401, cors);
      }

      // GET /api/admin/reports?status=pending&parkId=wdw&limit=200
      if (url.pathname === "/api/admin/reports" && request.method === "GET") {
        const status = safeStatus(url.searchParams.get("status") || "pending");
        const parkId = url.searchParams.get("parkId"); // optional filter
        const limit = clampInt(url.searchParams.get("limit"), 1, 200, 200);

        let query = `
          SELECT
            id, server_id, map_version, park_id,
            lat, lng, zoom,
            bbox_west, bbox_south, bbox_east, bbox_north,
            category, description, display_name,
            status, admin_notes,
            created_at, updated_at, approved_at
          FROM change_reports
          WHERE status = ?
        `;
        const binds = [status];

        if (parkId) {
          query += ` AND park_id = ?`;
          binds.push(parkId);
        }

        query += ` ORDER BY created_at DESC LIMIT ?`;
        binds.push(limit);

        const stmt = env.DB.prepare(query).bind(...binds);
        const { results } = await stmt.all();
        return json({ results }, 200, cors);
      }

      // PATCH /api/admin/reports/:id
      // body can include: parkId/serverId/mapVersion/lat/lng/zoom/category/description/displayName/adminNotes
      const mEdit = url.pathname.match(/^\/api\/admin\/reports\/([^/]+)$/);
      if (mEdit && request.method === "PATCH") {
        const id = decodeURIComponent(mEdit[1]);

        let body;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid JSON" }, 400, cors);
        }

        const parkId = body.parkId != null ? safeText(body.parkId, 20) : undefined;
        const serverId = body.serverId != null ? safeText(body.serverId, 80) : undefined;
        const mapVersion = body.mapVersion != null ? safeText(body.mapVersion, 40) : undefined;
        const category = body.category != null ? safeText(body.category, 40) : undefined;
        const description = body.description != null ? safeText(body.description, 2000) : undefined;
        const displayName = body.displayName != null ? safeText(body.displayName, 60) : undefined;
        const adminNotes = body.adminNotes != null ? safeText(body.adminNotes, 2000) : undefined;

        const lat = body.lat != null ? Number(body.lat) : undefined;
        const lng = body.lng != null ? Number(body.lng) : undefined;
        const zoom = body.zoom != null ? Number(body.zoom) : undefined;

        const fields = [];
        const binds = [];

        function addField(sql, val) {
          fields.push(sql);
          binds.push(val);
        }

        if (parkId !== undefined) addField("park_id = ?", parkId);
        if (serverId !== undefined) addField("server_id = ?", serverId);
        if (mapVersion !== undefined) addField("map_version = ?", mapVersion);
        if (category !== undefined) addField("category = ?", category);
        if (description !== undefined) addField("description = ?", description);
        if (displayName !== undefined) addField("display_name = ?", displayName || null);
        if (adminNotes !== undefined) addField("admin_notes = ?", adminNotes || null);

        if (lat !== undefined) {
          if (!Number.isFinite(lat) || lat < -90 || lat > 90) return json({ error: "lat invalid" }, 400, cors);
          addField("lat = ?", lat);
        }
        if (lng !== undefined) {
          if (!Number.isFinite(lng) || lng < -180 || lng > 180) return json({ error: "lng invalid" }, 400, cors);
          addField("lng = ?", lng);
        }
        if (zoom !== undefined) {
          if (!Number.isFinite(zoom)) return json({ error: "zoom invalid" }, 400, cors);
          addField("zoom = ?", zoom);
        }

        if (!fields.length) {
          return json({ error: "No editable fields provided" }, 400, cors);
        }

        const now = new Date().toISOString();
        fields.push("updated_at = ?");
        binds.push(now);

        binds.push(id);

        await env.DB.prepare(`
          UPDATE change_reports
          SET ${fields.join(", ")}
          WHERE id = ?
        `).bind(...binds).run();

        return json({ ok: true, id, updatedAt: now }, 200, cors);
      }

      // POST /api/admin/reports/:id/approve
      const mApprove = url.pathname.match(/^\/api\/admin\/reports\/([^/]+)\/approve$/);
      if (mApprove && request.method === "POST") {
        const id = decodeURIComponent(mApprove[1]);
        const now = new Date().toISOString();

        await env.DB.prepare(`
          UPDATE change_reports
          SET status = 'approved',
              approved_at = ?,
              updated_at = ?
          WHERE id = ?
        `).bind(now, now, id).run();

        return json({ ok: true, id, status: "approved", approvedAt: now }, 200, cors);
      }

      // POST /api/admin/reports/:id/reject
      const mReject = url.pathname.match(/^\/api\/admin\/reports\/([^/]+)\/reject$/);
      if (mReject && request.method === "POST") {
        const id = decodeURIComponent(mReject[1]);

        let body = {};
        try {
          body = await request.json().catch(() => ({}));
        } catch {}

        const reason = safeText(body.reason || "", 2000);
        const now = new Date().toISOString();

        await env.DB.prepare(`
          UPDATE change_reports
          SET status = 'rejected',
              admin_notes = ?,
              updated_at = ?
          WHERE id = ?
        `).bind(reason || null, now, id).run();

        return json({ ok: true, id, status: "rejected", updatedAt: now }, 200, cors);
      }

      return json({ error: "Not found" }, 404, cors);
    }

    return withCors(new Response("Not found", { status: 404 }));
  },
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function safeText(v, maxLen) {
  if (v == null) return "";
  return String(v).trim().slice(0, maxLen);
}

function clampInt(v, min, max, fallback) {
  const n = parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function safeStatus(v) {
  const s = String(v || "").toLowerCase();
  if (s === "pending" || s === "approved" || s === "rejected") return s;
  return "pending";
}

function isAuthedAdmin(request, env) {
  const expected = (env.ADMIN_TOKEN || "").trim();
  if (!expected) return false;

  const h = request.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : "";

  return token && token === expected;
}
