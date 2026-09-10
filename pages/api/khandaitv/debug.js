// ROUTE TẠM ĐỂ DÒ LỖI (10/09/2026) — gọi thẳng khandai3.link, KHÔNG nuốt lỗi
// như khandaitv.service.js (service chính luôn try/catch rồi trả mảng rỗng
// khi lỗi, nên không thấy được lý do thật qua API bình thường). Sau khi dò
// xong nguồn Khán Đài, có thể xoá file này (không ảnh hưởng gì tới các route
// khác).
import axios from 'axios';

export default async function handler(req, res) {
  const base = process.env.KHANDAITV_DOMAIN || process.env.KHANDAITV_BASE_URL || 'https://khandai3.link';
  const url = `${base}/api/matches/?ordering=smart&page_size=10&_t=${Date.now()}`;

  const result = {
    triedUrl: url,
    baseUrlUsed: base
  };

  try {
    const response = await axios.get(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': `${base}/`
      }
    });
    result.ok = true;
    result.status = response.status;
    result.dataSample = response.data;
  } catch (error) {
    result.ok = false;
    result.errorMessage = error.message;
    result.errorCode = error.code || null;
    result.httpStatus = error.response?.status ?? null;
    result.httpStatusText = error.response?.statusText ?? null;
    // Cloudflare/anti-bot thường trả HTML thay vì JSON — cắt ngắn để dễ đọc.
    const body = error.response?.data;
    result.responseBodySample = typeof body === 'string' ? body.slice(0, 1500) : body;
    result.responseHeaders = error.response?.headers || null;
  }

  return res.status(200).json(result);
}
