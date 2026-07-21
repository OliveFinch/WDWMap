/**
 * TDR Tile Proxy Worker
 *
 * This Cloudflare Worker proxies tile requests to Tokyo Disney Resort's map tile server,
 * adding the required CloudFront authentication cookies and User-Agent header.
 *
 * Deploy this worker and configure a route like:
 *   yoursite.com/tdr-tiles/* -> this worker
 *
 * IMPORTANT: Update the cookies when they expire!
 */

// =====================
// TDR Configuration - UPDATE THESE WHEN EXPIRED
// =====================
const TDR_CONFIG = {
  // Base URL for TDR map tiles
  tileBaseUrl: 'https://contents-portal.tokyodisneyresort.jp/limited/map-image/20260122183830/daytime/',

  // Required User-Agent header (mimics the official TDR app)
  userAgent: 'Disney Resort/3.11.5 (jp.tokyodisneyresort.portalapp; build:2; iOS 26.5.0) Alamofire/5.10.2',

  // CloudFront signed cookies (time-limited authentication)
  // These expire and need to be refreshed periodically
  cookies: {
    'CloudFront-Signature': 'csYpiTNoniW7o~WK6aL-z2~D68eMyeyEsyiMlOos~j6E7qJoz9Xl5bsKc8bqGNg9mGWwNI96Sc22QeZC~oGelacRwtE5RXTaWBB9AGBCvJf0B4vfmxzSLu~f5L40tWq4NmMWTfaK~VCdTKx0sgDXyx6LWiwJ-64Fyn8czGjSZ63rt~FRNkIx8b~gjV2Cf2BBxKhFaQFzYgLEvvNT9XIbeBc1GC-5HntCtXzZrgmyC3NwdkDGdPiQ5Dl-9~I5xFVo3u6tfMnToDRntf4UNsstgwX9mD7grezBy07~3njjV9mWd0Ko6FPPG9vegDFpCCJms6i-n7sTr1DjvGvZHRa6jg__',
    'CloudFront-Key-Pair-Id': 'APKAIJUGP2GGEWDAPMTQ',
    'CloudFront-Policy': 'eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vY29udGVudHMtcG9ydGFsLnRva3lvZGlzbmV5cmVzb3J0LmpwLyoiLCJDb25kaXRpb24iOnsiRGF0ZUxlc3NUaGFuIjp7IkFXUzpFcG9jaFRpbWUiOjE3NzI0NDIzNzl9LCJJcEFkZHJlc3MiOnsiQVdTOlNvdXJjZUlwIjoiMC4wLjAuMC8wIn19fV19'
  }
};

// Build cookie string from config (no space after semicolon to match curl format)
function buildCookieString() {
  return Object.entries(TDR_CONFIG.cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join(';');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Extract the tile path from the request
    // Expected format: /tdr-tiles/z{zoom}/{x}_{y}.jpg
    const pathMatch = url.pathname.match(/\/tdr-tiles\/(.+)$/);

    if (!pathMatch) {
      return new Response('Invalid tile path', { status: 400 });
    }

    const tilePath = pathMatch[1];
    const tileUrl = TDR_CONFIG.tileBaseUrl + tilePath;

    try {
      // Fetch the tile from TDR with required authentication
      const tileResponse = await fetch(tileUrl, {
        method: 'GET',
        headers: {
          'User-Agent': TDR_CONFIG.userAgent,
          'Cookie': buildCookieString(),
          'Accept': 'image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,ja;q=0.8',
          'Referer': 'https://www.tokyodisneyresort.jp/'
        }
      });

      if (!tileResponse.ok) {
        // Return a transparent placeholder for missing tiles
        if (tileResponse.status === 404 || tileResponse.status === 403) {
          return new Response(null, {
            status: 204,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'public, max-age=3600'
            }
          });
        }

        return new Response(`Tile fetch failed: ${tileResponse.status}`, {
          status: tileResponse.status,
          headers: { 'Access-Control-Allow-Origin': '*' }
        });
      }

      // Return the tile with CORS headers for browser access
      const tileData = await tileResponse.arrayBuffer();

      return new Response(tileData, {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400', // Cache tiles for 24 hours
          'X-TDR-Proxy': 'true'
        }
      });

    } catch (error) {
      return new Response(`Proxy error: ${error.message}`, {
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }
  }
};
