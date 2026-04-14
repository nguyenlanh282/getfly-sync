/**
 * Cloudflare Pages Function — POST /api/proxy
 * method: POST | PUT | UPSERT
 *
 * UPSERT logic:
 *   1. Thử POST (tạo mới)
 *   2. Nếu Getfly báo TRÙNG MÃ (409, hoặc message chứa "tồn tại"/"exist"/"duplicate")
 *      → thử PUT (cập nhật)
 *   3. Mọi lỗi khác (400, 422, 500...) → trả ngay lỗi gốc từ POST, KHÔNG thử PUT
 */
export async function onRequestPost(context) {
  try {
    const { apiKey, domain, method, payload } = await context.request.json();
    if (!apiKey || !domain || !payload) {
      return Response.json({ ok: false, error: 'Thiếu tham số bắt buộc' }, { status: 400 });
    }

    const url     = `https://${domain}/api/v6.1/account`;
    const headers = { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' };

    // ── UPSERT ───────────────────────────────────────────────
    if (method === 'UPSERT') {
      // Bước 1: Thử POST
      const postRes  = await safeFetch(url, 'POST', headers, payload);

      if (postRes.ok) {
        return Response.json({ ok: true, status: postRes.status, data: postRes.data, action: 'created' });
      }

      // Bước 2: Kiểm tra có đúng là lỗi TRÙNG MÃ không
      //         CHỈ dùng 409 (Conflict) hoặc message chứa từ khoá trùng
      //         KHÔNG dùng 422 vì 422 là validation error (thiếu field, sai format…)
      const body    = JSON.stringify(postRes.data).toLowerCase();
      const isDup   = postRes.status === 409
        || body.includes('tồn tại')
        || body.includes('exist')
        || body.includes('duplicate')
        || body.includes('đã có')
        || body.includes('already');

      if (isDup && payload.account_code) {
        // Bước 3: Thử PUT
        const putPayload = { ...payload, current_account_code: payload.account_code };
        const putRes     = await safeFetch(url, 'PUT', headers, putPayload);

        if (putRes.ok) {
          return Response.json({ ok: true, status: putRes.status, data: putRes.data, action: 'updated' });
        }

        // PUT cũng thất bại → trả lỗi PUT (kèm lỗi POST gốc để debug)
        return Response.json({
          ok: false, status: putRes.status, data: putRes.data, action: 'failed',
          errorDetail: humanError(putRes.data, putRes.status),
          note: `POST lỗi: ${humanError(postRes.data, postRes.status)} → thử PUT → cũng thất bại`
        });
      }

      // Lỗi POST không phải trùng mã → trả thẳng lỗi POST
      return Response.json({
        ok: false, status: postRes.status, data: postRes.data, action: 'failed',
        errorDetail: humanError(postRes.data, postRes.status)
      });
    }

    // ── POST / PUT thông thường ──────────────────────────────
    const httpMethod = method === 'PUT' ? 'PUT' : 'POST';
    const res = await safeFetch(url, httpMethod, headers, payload);

    return Response.json({
      ok: res.ok,
      status: res.status,
      data: res.data,
      action: res.ok ? (httpMethod === 'PUT' ? 'updated' : 'created') : 'failed',
      errorDetail: res.ok ? null : humanError(res.data, res.status)
    });

  } catch (e) {
    const isTimeout = e.name === 'TimeoutError' || e.message.includes('timeout');
    return Response.json({
      ok: false, action: 'failed',
      error: e.message,
      errorDetail: isTimeout ? 'Getfly không phản hồi (timeout > 10s)' : e.message
    }, { status: 500 });
  }
}

// ── Helper: gọi fetch an toàn, luôn trả { ok, status, data } ──
async function safeFetch(url, method, headers, body) {
  const res = await fetch(url, {
    method,
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  let data = {};
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}

// ── Helper: chuyển lỗi HTTP → thông báo tiếng Việt dễ hiểu ──
function humanError(data, status) {
  // Ưu tiên lấy message từ Getfly
  const fromGetfly = data?.message || data?.error || data?.msg
    || (data?.errors ? Object.values(data.errors).flat().join(' | ') : null);

  if (fromGetfly) return fromGetfly;

  // Fallback theo HTTP status
  const map = {
    400: 'Dữ liệu gửi lên không hợp lệ — kiểm tra lại các trường bắt buộc',
    401: 'API Key không hợp lệ hoặc đã hết hạn',
    403: 'Không có quyền thực hiện thao tác này',
    404: 'Bản ghi không tồn tại trong Getfly',
    409: 'Mã khách hàng (account_code) đã tồn tại trong hệ thống',
    422: 'Dữ liệu không đúng định dạng — kiểm tra ngày sinh, số điện thoại, tên loại KH...',
    429: 'Quá nhiều request — vui lòng thử lại sau vài giây',
    500: 'Lỗi máy chủ Getfly — thử lại sau',
  };
  return map[status] || `Lỗi không xác định (HTTP ${status})`;
}
