# ✅ FIX ĐÃ ÁP DỤNG - Chuối Chiên Override Referer

## 🎯 Fix Được Áp Dụng

Project này **ĐÃ CÓ FIX** cho lỗi Chuối Chiên không xem được trên app IPTV.

### **3 File Đã Sửa:**

1. ✅ **src/utils/m3uPlaylist.js**
   - Thêm hàm `getOverrideReferer()`
   - Call hàm trong `resolveIptvReferer()`
   - Thêm log warning khi fallback

2. ✅ **.github/workflows/validate-and-generate.yml**
   - Thêm 2 env var:
     - `CHUOICHIENTV_IPTV_REFERER`
     - `CHUOICHIENTV_PLAYER_DOMAIN`

3. ✅ **env.example**
   - Thêm hướng dẫn + biến referer override

---

## 🚀 Quick Deploy (2 Bước)

### **Bước 1: Install Dependencies**
```bash
npm install
# hoặc
npm ci
```

### **Bước 2: Set GitHub Secrets**

**Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Thêm **2 secrets:**

| Name | Value |
|------|-------|
| `CHUOICHIENTV_IPTV_REFERER` | `https://live.chuoichien.tv/` |
| `CHUOICHIENTV_PLAYER_DOMAIN` | `https://live.chuoichien.tv/` |

---

### **Bước 3: Push & Trigger**

```bash
git add .
git commit -m "Deploy: Fixed Chuối Chiên referer"
git push
```

Sau đó:
- GitHub → **Actions** → **Generate Playlists** → **Run workflow**
- Chờ 2-5 phút

---

## ✅ Kiểm Tra Fix Hoạt Động

**Log workflow:**
- Actions > workflow > step "Generate playlists"
- Tìm: `[m3uPlaylist] Dùng override referer từ CHUOICHIENTV_IPTV_REFERER`

**File .m3u8:**
```bash
curl -s https://raw.githubusercontent.com/.../all.m3u | grep -B2 -A2 "Chuối Chiên"
```

Expected:
```
#EXTVLCOPT:http-referrer=https://live.chuoichien.tv/
#EXTVLCOPT:http-user-agent=Mozilla/5.0...
https://gckc0525.edgemaxcdn.org/live/chuoichao/playlist.m3u8
```

**Test app IPTV:**
- Import file .m3u8
- Play trận Chuối Chiên
- Nên phát được ✅

---

## ⚠️ Lưu Ý

- **Referer có thể thay đổi** - nếu vẫn lỗi sau vài tuần, lấy lại từ DevTools
- **Cách lấy referer:** Mở https://live.chuoichien.tv/ → Play → F12 Network → tìm `.m3u8` request → copy header `Referer` từ **Request Headers**
- **Update referer:** Thay đổi GitHub Secrets → Trigger workflow lại

---

## 📝 Các File Gốc (Tham Khảo)

Nếu muốn hiểu chi tiết:
- `QUICK_START.md` - Giải pháp nhanh gọn
- `PATCH_INSTRUCTIONS.md` - Chi tiết code từng chỗ

---

## 🎉 Chúc Bạn Thành Công!

Nếu vẫn có lỗi:
1. Kiểm tra GitHub Secrets đã set đúng chưa
2. Kiểm tra workflow log có message override referer chưa
3. Kiểm tra referer mới từ DevTools (có thể đã đổi)

