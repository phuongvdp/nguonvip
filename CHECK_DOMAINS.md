# Domain các nguồn: khai báo trong 1 biến + tự quét domain chết (Check Domains)

## 1. Khai báo TẤT CẢ domain trong 1 biến `SOURCE_DOMAINS`
Repo → **Settings → Secrets and variables → Actions → tab Variables → New repository variable**
- Name: `SOURCE_DOMAINS`
- Value: mỗi dòng `tên=domain` (dòng bắt đầu bằng `#` là ghi chú). Copy mẫu bên dưới (cũng có trong file `source-domains.example.txt`) rồi sửa domain cần đổi:

```
# Mỗi dòng: tên=domain. Dòng bắt đầu bằng # là ghi chú. Xoá/để trống 1 dòng = dùng domain mặc định trong code.
# Quét tự động: workflow "Check Domains" sẽ tự sửa dòng nào có domain chết.
giovang=https://giovang.blog
khandaitv=https://khandai3.link
phaohoa=https://phaohoa1.live
gavang=https://gavanglinkp.tv
gavang33=https://gavang33.me
saoke=https://vip3.saoketv40.xyz
bonglau=https://lau05.bonglautv1.pro
phalang=https://phalang.live
# chuoichientv=https://live05.chuoichientv.me   # tuỳ chọn: bỏ # sẽ ÉP cố định domain này (mặc định code tự dò liveNN.chuoichientv.me)
chuoichientv-player=https://live.chuoichien.tv
saoke-player=https://sk.mediastation.live
bonglau-player=https://live.chuoichien.tv
giovang-api=https://live-api.keonhacaitp.one
saoke-api=https://skapi.66887979.xyz
gavang33-api=https://gavangtv-api.adviceme.io
phalang-api=https://api.plapi202624081158.com
chuoichientv-api=https://api-v2.chuoichientv.net/v2
bonglau-api=https://api-v2.chuoichientv.net/v2
```

- Muốn đổi domain 1 nguồn: **sửa dòng đó** rồi lưu — lần chạy `Generate Playlists` kế tiếp (hoặc bấm Run workflow) dùng domain mới. Không cần sửa code.
- Xoá/để trống 1 dòng = nguồn đó dùng domain mặc định trong code. Không cần khai báo đủ — chỉ khai báo nguồn nào cần đổi.
- "tên" là key ngắn ở bảng trên **hoặc** đúng tên biến cũ (`GIOVANG_DOMAIN`, `SAOKE_BASE_URL`...), không phân biệt hoa thường. Gõ sai tên thì bị bỏ qua và hiện cảnh báo (kèm gợi ý, vd *"ý bạn là giovang?"*) ở mục Summary của lần chạy.
- Có thể viết dạng JSON thay cho dòng: `{"giovang":"https://giovang.blog","saoke":"https://vip3.saoketv40.xyz"}`.
- Giá trị thiếu `https://` sẽ tự thêm; dấu `/` cuối tự bỏ. Với domain API có đường dẫn (vd `.../v2`) thì giữ nguyên đường dẫn.
- **Thứ tự ưu tiên** từng nguồn: dòng trong `SOURCE_DOMAINS` → biến riêng lẻ cũ (nếu bạn đã tạo, vd `GIOVANG_DOMAIN`) → domain mặc định trong code.
- Dòng `chuoichientv` (trang xem) để dạng ghi chú: code **tự dò** `liveNN.chuoichientv.me`; khai báo sẽ ÉP cố định 1 domain.
- Mỗi lần chạy `Generate Playlists`, bước **Expand source domains** in bảng "Domain các nguồn đang dùng" ở mục Summary để bạn kiểm tra.

## 2. Quét domain chết & tự cập nhật (workflow `Check Domains`, chạy tay)
Workflow `Check Domains` quét xem domain của từng nguồn còn sống không. Domain nào chết hoặc đã chuyển
hướng → tự tìm domain mới → **sửa đúng dòng đó trong `SOURCE_DOMAINS`** (giữ nguyên các dòng/ghi chú khác) →
chạy lại `Generate Playlists` để dùng ngay.

### Thiết lập 1 lần
1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
   - Repository access: chọn đúng repo này
   - Repository permissions → **Variables: Read and write**
2. Repo → **Settings → Secrets and variables → Actions → Secrets → New repository secret**
   - Name: `GH_VARIABLES_TOKEN`, Value: token vừa tạo.

Không có secret này workflow vẫn quét và báo cáo, nhưng **không ghi được biến** (GITHUB_TOKEN mặc
định của GitHub không có quyền ghi Variables). Khi đó bảng kết quả cho biết dòng `tên=domain` cần tự thêm/sửa vào `SOURCE_DOMAINS`.

### Cách chạy
Tab **Actions → Check Domains → Run workflow**. Các ô:
- `auto_fix`: bật = tự ghi biến khi tìm được domain mới; tắt = chỉ quét.
- `sources`: `all` hoặc danh sách key, ví dụ `giovang,saoke` (gồm cả domain API/player của nguồn đó).
- `extra_candidates`: domain mới bạn **biết** (cách nhau dấu phẩy) — được thử đầu tiên cho nguồn nào chết.
- `restart_generator`: đổi biến xong thì chạy lại `Generate Playlists`.

Kết quả hiện ở mục **Summary** của lần chạy (bảng: nguồn, biến, domain hiện tại, trạng thái, domain mới, hành động).

### Trạng thái
| Trạng thái | Ý nghĩa | Có tự đổi biến? |
|---|---|---|
| 🟢 sống | trả 2xx/3xx và nội dung đúng tên nguồn | không |
| 🟠 đã chuyển | trang tự chuyển hướng sang domain khác (vd `giovang.city → giovang.blog`) | **có** (nếu nội dung đúng nguồn) |
| 🔴 chết | không phân giải/kết nối được, timeout, 404 ở trang chủ, hoặc là trang rao bán/hết hạn | **có** — tự tìm domain thay thế |
| 🟡 bị chặn bot | Cloudflare/WAF chặn IP máy chủ GitHub — **không kết luận được** | không |
| 🟡 nghi ngờ / lỗi tạm | trang 200 nhưng nội dung lạ, hoặc 5xx | không (chỉ cảnh báo) |

Lỗi mạng/5xx luôn được thử lại 1 lần trước khi kết luận.

### Cách tìm domain mới (theo thứ tự ưu tiên, nhóm nào có kết quả hợp lệ thì dừng)
1. `extra_candidates` bạn nhập.
2. Biến ứng viên riêng của nguồn: `<TÊN_BIẾN>_CANDIDATES` (đặt trong env của bước quét), ví dụ `GIOVANG_DOMAIN_CANDIDATES=giovang.tv,giovang.me`.
3. Mirror đã biết trong `scripts/check-domains.mjs` (mảng `candidates`).
4. Biến thể tự sinh: đổi số trong tên (`khandai3 → khandai4`, `lau05 → lau06`), đổi đuôi (`.link/.live/.tv/.cc/.cv/...`), hoặc cả hai.

Domain mới chỉ được nhận khi: phân giải DNS được, trả 2xx/3xx, **không** phải trang đỗ tên miền,
và trong nội dung có tên nguồn (chống domain bị người khác mua lại).

### Nguồn nào tự sửa, nguồn nào chỉ báo cáo
- **Tự sửa dòng** khi domain chết/chuyển: `giovang`, `khandaitv`, `phaohoa`, `gavang`, `gavang33`, `saoke`, `bonglau`, `phalang`.
- **Chỉ báo cáo** (tự sửa dòng trong `SOURCE_DOMAINS` nếu cần): `chuoichientv` (code **tự dò** `liveNN.chuoichientv.me`), các domain player (`*-player`) và domain API (`*-api`).
- Ứng viên riêng cho 1 nguồn (tuỳ chọn): đặt biến môi trường `<TÊN_BIẾN_CŨ>_CANDIDATES` cho bước quét, vd `GIOVANG_DOMAIN_CANDIDATES=giovang.tv,giovang.me`.
- Thêm nguồn mới vào danh sách: thêm 1 dòng vào mảng `SOURCES` trong `scripts/source-domains.mjs`, rồi thêm biến tương ứng vào bước `Expand source domains` của `validate-and-generate.yml` và bước quét của `check-domains.yml`.

### Giới hạn cần biết
- Không tìm được nếu nguồn đổi **hẳn tên** (không còn giống tên cũ) → nhập domain mới vào `extra_candidates`.
- Một số trang chặn IP máy chủ GitHub → hiện 🟡 "bị chặn bot", script không tự đổi để tránh sửa nhầm.
- Domain **API** và **player/Referer** chỉ báo cáo, vì không thể đoán an toàn từ tên.
- Nếu `SOURCE_DOMAINS` là JSON hỏng thì toàn bộ biến bị bỏ qua (có cảnh báo) và không tự gộp được — sửa tay lại cho đúng.
