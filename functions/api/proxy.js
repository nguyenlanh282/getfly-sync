/**
 * Cloudflare Pages Function
 * POST /api/proxy
 * Proxy từng record lên Getfly API (tránh CORS)
 */
export async function onRequestPost(context) {
  try {
    const { apiKey, domain, method, payload } = await context.request.json();

    if (!apiKey || !domain || !payload) {
      return Response.json({ ok: false, error: 'Thiếu tham số' }, { status: 400 });
    }

    const url = `https://${domain}/api/v6.1/account`;
    const res = await fetch(url, {
      method: method || 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });

    let data = {};
    try { data = await res.json(); } catch {}

    return Response.json({ ok: res.ok, status: res.status, data });

  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
