#!/usr/bin/env node
// Sinh sẵn file .m3u tĩnh cho từng môn thể thao, lưu vào public/playlists/
// để commit vào repo — dùng bởi .github/workflows/validate-and-generate.yml
// (cron kiểm tra mỗi 5 phút, hoặc khi data/sources.json thay đổi).
//
// TẠI SAO GỌI QUA HTTP TỚI TRANG ĐÃ DEPLOY THAY VÌ QUÉT LẠI TỪ ĐẦU:
// Các service quét nguồn (src/services/*.service.js) dùng alias "@/..." —
// chỉ Next.js/webpack hiểu lúc build, Node chạy trực tiếp một file .js
// không hiểu alias này (và phần lớn import trong code cũng không có đuôi
// .js, Node ESM cũng không tự suy ra được). Ngoài ra 1 số nguồn (VSC9,
// Giovang) cần mở Chromium headless mới lấy được stream — cài + chạy lại
// trong GitHub Actions mỗi 5 phút vừa nặng vừa dễ timeout.
// => Gọi thẳng /api/playlist trên chính trang đã chạy (Vercel) là chắc ăn
// nhất: tái dùng đúng 100% logic thật, không lặp code, không cần cài thêm
// gì trong CI ngoài Node.
//
// TỰ GIÃN/THU CHU KỲ LÀM MỚI:
// GitHub Actions cron không tự đổi lịch được (chỉ khai báo tĩnh trong file
// .yml) — nên cron vẫn "gõ cửa" đều mỗi 5 phút như bình thường, nhưng bản
// thân script tự quyết định có LÀM THẬT hay không dựa vào trạng thái lưu ở
// public/playlists/.refresh-state.json (được commit lại cùng playlist, nên
// nhớ được giữa các lần chạy):
//   - Có trận live -> lần chạy tiếp theo giữ nguyên 5 phút.
//   - Không có trận live -> giãn dần chu kỳ ra (x2 mỗi lần, tối đa 2 tiếng)
//     để đỡ tốn phút chạy CI + đỡ tạo commit rỗng khi chẳng có gì thay đổi.
//   - Chưa tới giờ hẹn -> bỏ qua lần chạy này (không gọi mạng, không ghi
//     file gì cả).

const fs = require('fs');
const path = require('path');

// Khớp với SPORT_TABS trong src/utils/playerGet.js (bỏ 'esports' vì cũng bị
// lọc bỏ ở đó).
const SPORT_TABS = ['all', 'football', 'basketball', 'volleyball', 'badminton', 'tennis'];

// Khớp với SOURCE_GROUP_ORDER trong src/utils/playerGet.js — playlist tĩnh
// RIÊNG từng nguồn (source-xoilac.m3u, source-phaohoa.m3u...), song song
// với playlist theo môn ở trên. Không import trực tiếp từ playerGet.js vì
// lý do đã nêu ở đầu file (alias "@/..." chỉ Next.js/webpack hiểu).
const SOURCE_KEYS = ['xoilac', 'phaohoa', 'gavang', 'giovang'];

const SITE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://nguonvip.vercel.app').replace(/\/+$/, '');
// Domain không phải thông tin nhạy cảm nên đặt sẵn giá trị mặc định — không
// bắt buộc phải khai báo secret gì trên GitHub. Chỉ cần set biến SITE_URL
// (secret hoặc biến môi trường) nếu sau này đổi sang domain khác.
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'playlists');
const STATE_PATH = path.join(OUTPUT_DIR, '.refresh-state.json');

const BASE_INTERVAL_MIN = 5; // chu kỳ chuẩn khi đang có trận live
const MAX_INTERVAL_MIN = 120; // trần giãn tối đa (2 tiếng) khi im ắng kéo dài
const WATCH_INTERVAL_MS = BASE_INTERVAL_MIN * 60 * 1000; // dùng cho `--watch` chạy local

function isWatchMode() {
  return process.argv.includes('--watch');
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return null; // chưa có state (lần đầu chạy) — coi như tới giờ luôn
  }
}

function writeState(state) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

async function fetchPlaylist(sport, source) {
  const params = new URLSearchParams({ sport });
  if (source) params.set('source', source);
  const url = `${SITE_URL}/api/playlist?${params.toString()}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'generate-playlists-ci' } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} khi gọi ${url}`);
  }
  return res.text();
}

/** @returns {Promise<{ ok: boolean, liveMatchCount: number }>} */
async function generateOnce() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let hasError = false;
  let liveMatchCount = 0;
  for (const sport of SPORT_TABS) {
    try {
      const content = await fetchPlaylist(sport);
      const filename = `${sport}.m3u`;
      fs.writeFileSync(path.join(OUTPUT_DIR, filename), content, 'utf8');
      const matchCount = (content.match(/^#EXTINF/gm) || []).length;
      if (sport === 'all') liveMatchCount = matchCount; // playlist "all" = mọi trận đang live có stream, dùng làm chỉ số quyết định giãn/thu chu kỳ
      console.log(`[generate-playlists] ${filename}: ${matchCount} trận`);
    } catch (err) {
      hasError = true;
      console.error(`[generate-playlists] Lỗi khi tạo playlist "${sport}":`, err.message);
    }
  }

  // Playlist tĩnh riêng từng nguồn (mọi môn thể thao gộp, chỉ lọc theo
  // nguồn) — không tính vào liveMatchCount vì đã tính đủ ở playlist "all"
  // phía trên, tránh đếm trùng khi quyết định giãn/thu chu kỳ.
  for (const source of SOURCE_KEYS) {
    try {
      const content = await fetchPlaylist('all', source);
      const filename = `source-${source}.m3u`;
      fs.writeFileSync(path.join(OUTPUT_DIR, filename), content, 'utf8');
      const matchCount = (content.match(/^#EXTINF/gm) || []).length;
      console.log(`[generate-playlists] ${filename}: ${matchCount} trận`);
    } catch (err) {
      hasError = true;
      console.error(`[generate-playlists] Lỗi khi tạo playlist nguồn "${source}":`, err.message);
    }
  }

  return { ok: !hasError, liveMatchCount };
}

async function runAdaptiveCycle() {
  const now = Date.now();
  const state = readState();

  if (state?.nextCheckAt && now < state.nextCheckAt) {
    const remainMin = Math.ceil((state.nextCheckAt - now) / 60000);
    console.log(
      `[generate-playlists] Bỏ qua lần này — đang giãn chu kỳ vì không có trận live ` +
      `(còn ~${remainMin} phút nữa mới tới giờ hẹn, chu kỳ hiện tại: ${state.intervalMin} phút).`
    );
    return true;
  }

  const { ok, liveMatchCount } = await generateOnce();

  const prevInterval = state?.intervalMin || BASE_INTERVAL_MIN;
  const nextInterval = liveMatchCount > 0
    ? BASE_INTERVAL_MIN
    : Math.min(prevInterval * 2, MAX_INTERVAL_MIN);

  writeState({
    lastRunAt: new Date(now).toISOString(),
    liveMatchCount,
    intervalMin: nextInterval,
    nextCheckAt: now + nextInterval * 60 * 1000,
  });

  console.log(
    liveMatchCount > 0
      ? `[generate-playlists] Đang có ${liveMatchCount} trận live — giữ chu kỳ ${BASE_INTERVAL_MIN} phút.`
      : `[generate-playlists] Không có trận live — giãn chu kỳ lần tới ra ${nextInterval} phút.`
  );

  return ok;
}

async function main() {
  console.log(`[generate-playlists] Dùng SITE_URL: ${SITE_URL}`);

  if (isWatchMode()) {
    console.log(`[generate-playlists] Chế độ watch (local) — kiểm tra mỗi ${WATCH_INTERVAL_MS / 60000} phút, tự giãn khi im ắng. Ctrl+C để dừng.`);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await runAdaptiveCycle();
      await new Promise((resolve) => setTimeout(resolve, WATCH_INTERVAL_MS));
    }
  }

  const ok = await runAdaptiveCycle();
  process.exit(ok ? 0 : 1);
}

main();
