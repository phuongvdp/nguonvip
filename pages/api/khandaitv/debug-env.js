// ROUTE TẠM ĐỂ DÒ LỖI libnss3.so (10/09/2026) — không gọi mạng ra ngoài
// (ngoại trừ chính @sparticuz/chromium-min tự tải gói pack.tar về /tmp nếu
// chưa có), chỉ soi trực tiếp môi trường Node.js + gói chromium đã cài
// trên chính server đang chạy. Có thể xoá file này sau khi xong.
//
// FIX (10/09/2026): đã xác nhận bản @sparticuz/chromium ĐẦY ĐỦ (gói
// thường) thiếu hẳn libnss3.so trên Node.js 20/22/24 của Vercel (AL2023
// không có sẵn NSS, gói lại không tự đóng gói kèm) — đã chuyển sang
// @sparticuz/chromium-min (tự tải gói .tar tự chứa từ GitHub Releases, xem
// src/utils/browserFetch.js). File debug này cập nhật theo để dò tiếp nếu
// vẫn còn lỗi sau khi đổi gói.
import fs from 'fs';
import path from 'path';
import chromiumPkg from '@sparticuz/chromium-min/package.json';

const CHROMIUM_PACK_VERSION = '131.0.1';
const CHROMIUM_PACK_URL = `https://github.com/Sparticuz/chromium/releases/download/v${CHROMIUM_PACK_VERSION}/chromium-v${CHROMIUM_PACK_VERSION}-pack.tar`;

export default async function handler(req, res) {
  const result = {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    isVercel: !!process.env.VERCEL,
    vercelRegion: process.env.VERCEL_REGION || null,
    ldLibraryPath: process.env.LD_LIBRARY_PATH || null,
    chromiumPackUrl: CHROMIUM_PACK_URL
  };

  try {
    result.installedChromiumMinVersion = chromiumPkg.version;
  } catch (error) {
    result.installedChromiumMinVersionError = error.message;
  }

  try {
    const chromium = (await import('@sparticuz/chromium-min')).default;
    const startedAt = Date.now();
    const executablePath = await chromium.executablePath(CHROMIUM_PACK_URL);
    result.downloadAndExtractMs = Date.now() - startedAt;
    result.executablePath = executablePath;

    const execDir = path.dirname(executablePath);
    result.execDirContents = fs.readdirSync(execDir);

    const nssCandidates = result.execDirContents.filter((f) => /nss|nspr|\.so/i.test(f));
    result.nssRelatedFiles = nssCandidates;
    result.hasLibnss3 = result.execDirContents.includes('libnss3.so');

    // Chromium của gói này đôi khi để .so trong 1 thư mục con "lib" riêng.
    const libSubdir = path.join(execDir, 'lib');
    if (fs.existsSync(libSubdir)) {
      result.libSubdirContents = fs.readdirSync(libSubdir);
      result.hasLibnss3InLibSubdir = result.libSubdirContents.includes('libnss3.so');
    }
  } catch (error) {
    result.chromiumInspectError = error.message;
  }

  return res.status(200).json(result);
}
