/**
 * Convert a scraped Vietnamese-site kickoff timestamp/text into a reliable
 * Date — used by every service that scrapes raw HTML instead of getting a
 * proper JSON kickoff field (xoilac, 90phut...).
 *
 * QUAN TRỌNG: khi chỉ có chuỗi giờ dạng "HH:mm dd/mm(/yyyy)" (không có
 * timezone), hàm này LUÔN hiểu là giờ Việt Nam (UTC+7), bất kể server chạy
 * ở múi giờ nào (Vercel chạy UTC). Không dùng `Date.parse()`/`new Date(str)`
 * trực tiếp cho việc này — hành vi của 2 hàm đó với chuỗi không chuẩn ISO
 * phụ thuộc engine, có thể trả về NaN hoặc hiểu theo giờ local của server
 * (UTC) thay vì giờ Việt Nam, khiến trận bị lệch ngày khi gộp sắp xếp
 * chung với các nguồn khác — đặc biệt dễ lộ ra ở các trận gần mốc nửa đêm.
 *
 * @param {string|number} runtimeValue Unix timestamp thô (giây hoặc mili-giây) nếu nguồn có sẵn — ưu tiên dùng cái này khi hợp lệ.
 * @param {string} [timeText] Chuỗi giờ/ngày dạng text quét được, ví dụ "20:00 10/08", "10/08 20:00", "20h00 10/08/2026".
 * @returns {Date|null} Date đúng, hoặc null nếu không parse được gì cả.
 */
function parseKickoffDate(runtimeValue, timeText = '') {
  const runtime = Number.parseInt(runtimeValue, 10);
  // The attribute is normally Unix seconds, but some templates emit ms.
  if (Number.isFinite(runtime) && runtime >= 1000000000) {
    const ms = runtime >= 100000000000 ? runtime : runtime * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date;
  }

  const text = String(timeText || '').replace(/\s+/g, ' ').trim();
  let parts = text.match(/(\d{1,2})\s*(?::|h)\s*(\d{2}).*?(\d{1,2})\s*[\/.\-]\s*(\d{1,2})(?:\s*[\/.\-]\s*(\d{2,4}))?/i);
  let hour;
  let minute;
  let day;
  let month;
  let year;

  if (parts) {
    [, hour, minute, day, month, year] = parts;
  } else {
    parts = text.match(/(\d{1,2})\s*[\/.\-]\s*(\d{1,2})(?:\s*[\/.\-]\s*(\d{2,4}))?.*?(\d{1,2})\s*(?::|h)\s*(\d{2})/i);
    if (!parts) return null;
    [, day, month, year, hour, minute] = parts;
  }

  const now = new Date();
  const fullYear = year ? (Number(year) < 100 ? 2000 + Number(year) : Number(year)) : now.getUTCFullYear();
  // Construct explicitly in Vietnam time (UTC+7), independent of server region.
  let date = new Date(Date.UTC(fullYear, Number(month) - 1, Number(day), Number(hour) - 7, Number(minute)));
  if (!year && date.getTime() < now.getTime() - 14 * 24 * 60 * 60 * 1000) {
    date = new Date(Date.UTC(fullYear + 1, Number(month) - 1, Number(day), Number(hour) - 7, Number(minute)));
  }
  return Number.isNaN(date.getTime()) ? null : date;
}

module.exports = { parseKickoffDate };
