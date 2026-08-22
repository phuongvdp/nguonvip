module.exports = {
  // Các site "lậu" này đổi domain rất thường xuyên (bị chặn DNS/ISP nên phải
  // dời domain liên tục) — xác nhận lúc 22/08/2026: domain "gavangtv.my" bạn
  // dùng chỉ REDIRECT sang domain thật là "gavangtv.spot" (trước đó code
  // đang mặc định "gavangtv.nl" — đã lỗi thời, khả năng cao đây là 1 phần
  // nguyên nhân dữ liệu/giờ giấc thất thường vì domain cũ có thể trỏ tới
  // trang đã đổi chủ, đổi theme, hoặc dữ liệu không còn được cập nhật đều).
  // Cho phép override qua biến môi trường GAVANG_BASE_URL trên Vercel để cập
  // nhật domain mới mà KHÔNG cần sửa code / deploy lại — NÊN set biến này
  // ngay khi domain đổi lần nữa (khả năng cao sẽ còn đổi tiếp) thay vì chờ
  // sửa code, ví dụ set GAVANG_DOMAIN=https://gavangtv.spot trên Vercel.
  GAVANG_URLS: {
    get BASE_URL() {
      return process.env.GAVANG_DOMAIN || process.env.GAVANG_BASE_URL || 'https://gavangtv.spot';
    },
    get LIVE_CONTENT() {
      return `${this.BASE_URL}/app/uploads/match-content/update-content-live.json`;
    },
    get INITIAL_CONTENT() {
      return `${this.BASE_URL}/app/uploads/match-content/update-content-initial.json`;
    },
  },
  PORT: process.env.PORT || 3000,
};
