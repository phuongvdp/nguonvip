module.exports = {
  // Các site "lậu" này đổi domain rất thường xuyên (bị chặn DNS/ISP nên phải
  // dời domain liên tục). Cho phép override qua biến môi trường GAVANG_BASE_URL
  // trên Vercel để cập nhật domain mới mà KHÔNG cần sửa code / deploy lại.
  GAVANG_URLS: {
    get BASE_URL() {
      return process.env.GAVANG_DOMAIN || process.env.GAVANG_BASE_URL || 'https://gavangtv.nl';
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
