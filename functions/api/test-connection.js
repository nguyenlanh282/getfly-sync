/**
 * Cloudflare Pages Function
 * POST /api/test-connection
 * Kiểm tra kết nối tới Getfly CRM
 */
export async function onRequestPost(context) {
  try {
    const { apiKey, domain } = await context.request.json();

    if (!apiKey || !domain) {
      return Response.json({ success: false, error: 'Thiếu Domain hoặc API Key' }, { status: 400 });
    }

    const res = await fetch(`https://${domain}/api/v6/accounts?limit=1`, {
      headers: { 'X-API-KEY': apiKey },
      signal: AbortSignal.timeout(8000)
    });

    if (res.ok) {
      return Response.json({ success: true, status: res.status });
    }

    let data = {};
    try { data = await res.json(); } catch {}

    return Response.json({
      success: false,
      error: data.message || data.error || `Lỗi HTTP ${res.status}`,
      httpStatus: res.status
    });

  } catch (e) {
    return Response.json({ success: false, error: e.message }, { status: 500 });
  }
}
