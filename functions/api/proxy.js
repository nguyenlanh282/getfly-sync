/**
 * Cloudflare Pages Function
 * POST /api/proxy
 * Proxy từng record lên Getfly API (tránh CORS)
 *
 * method:
 *   POST   → Tạo mới
 *   PUT    → Cập nhật (cần current_account_code)
 *   UPSERT → Thử tạo mới, nếu trùng mã → tự động cập nhật
 */
export async function onRequestPost(context) {
  try {
    const { apiKey, domain, method, payload } = await context.request.json();

    if (!apiKey || !domain || !payload) {
      return Response.json({ ok: false, error: 'Thiếu tham số bắt buộc' }, { status: 400 });
    }

    const url     = `https://${domain}/api/v6.1/account`;
    const headers = { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' };

    // ── UPSERT: thử POST → nếu trùng mã tự chuyển PUT ──────
    if (method === 'UPSERT') {
      // Bước 1: thử tạo mới
      const postRes  = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000)
      });

      let postData = {};
      try { postData = await postRes.json(); } catch {}

      if (postRes.ok) {
        return Response.json({ ok: true, status: postRes.status, data: postData, action: 'created' });
      }

      // Bước 2: kiểm tra có phải lỗi trùng mã không
      const bodyStr   = JSON.stringify(postData).toLowerCase();
      const isDup     = postRes.status === 409
        || postRes.status === 422
        || bodyStr.includes('tồn tại')
        || bodyStr.includes('exist')
        || bodyStr.includes('duplicate')
        || bodyStr.includes('đã có')
        || bodyStr.includes('already');

      if (isDup && payload.account_code) {
        // Bước 3: chuyển sang PUT
        const putPayload = { ...payload, current_account_code: payload.account_code };
        const putRes     = await fetch(url, {
          method: 'PUT',
          headers,
          body: JSON.stringify(putPayload),
          signal: AbortSignal.timeout(10000)
        });

        let putData = {};
        try { putData = await putRes.json(); } catch {}

        return Response.json({
          ok: putRes.ok,
          status: putRes.status,
          data: putData,
          action: putRes.ok ? 'updated' : 'failed',
          originalError: postData   // lỗi POST ban đầu để debug
        });
      }

      // Lỗi khác, không phải trùng mã
      return Response.json({
        ok: false,
        status: postRes.status,
        data: postData,
        action: 'failed',
        errorDetail: extractError(postData, postRes.status)
      });
    }

    // ── POST / PUT thông thường ──────────────────────────────
    const res = await fetch(url, {
      method: method || 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });

    let data = {};
    try { data = await res.json(); } catch {}

    return Response.json({
      ok: res.ok,
      status: res.status,
      data,
      action: res.ok ? (method === 'PUT' ? 'updated' : 'created') : 'failed',
      errorDetail: res.ok ? null : extractError(data, res.status)
    });

  } catch (e) {
    return Response.json({
      ok: false,
      error: e.message,
      action: 'failed',
      errorDetail: e.name === 'TimeoutError' ? 'Request timeout (>10s) — Getfly không phản hồi' : e.message
    }, { status: 500 });
  }
}

// ── Helper: trích xuất thông báo lỗi rõ ràng từ response ──
function extractError(data, httpStatus) {
  const known = {
    400: 'Dữ liệu không hợp lệ (Bad Request)',
    401: 'API Key không hợp lệ hoặc hết hạn',
    403: 'Không có quyền truy cập',
    404: 'Không tìm thấy bản ghi',
    409: 'Mã khách hàng đã tồn tại (trùng account_code)',
    422: 'Dữ liệu không đúng định dạng',
    429: 'Quá nhiều request — vui lòng thử lại sau',
    500: 'Lỗi máy chủ Getfly',
  };
  return data?.message
    || data?.error
    || data?.msg
    || (data?.errors ? Object.values(data.errors).flat().join(', ') : null)
    || known[httpStatus]
    || `HTTP ${httpStatus}`;
}
