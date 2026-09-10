// ROUTE TẠM ĐỂ DÒ LỖI libnss3.so (10/09/2026) — không gọi mạng ra ngoài,
// chỉ soi trực tiếp môi trường Node.js + gói @sparticuz/chromium đã cài
// trên chính server đang chạy, để biết chính xác:
//   1. Vercel đang chạy Node.js bản mấy (ảnh hưởng cách @sparticuz/chromium
//      tự chọn gói Chromium cho AL2 hay AL2023).
//   2. File libnss3.so có THỰC SỰ nằm trong thư mục chromium đã giải nén
//      hay không (nếu không có thật thì phải đổi phiên bản gói, không phải
//      lỗi đường dẫn LD_LIBRARY_PATH nữa).
//   3. Bản thân @sparticuz/chromium đã cài là version nào (package.json có
//      thể ghi "^131.0.0" nhưng bản thực cài có thể là 131.x.x bất kỳ).
// Có thể xoá file này sau khi xong.
import fs from 'fs';
import path from 'path';
import chromiumPkg from '@sparticuz/chromium/package.json';

export default async function handler(req, res) {
  const result = {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    isVercel: !!process.env.VERCEL,
    vercelRegion: process.env.VERCEL_REGION || null,
    ldLibraryPath: process.env.LD_LIBRARY_PATH || null
  };

  try {
    result.installedChromiumVersion = chromiumPkg.version;
  } catch (error) {
    result.installedChromiumVersionError = error.message;
  }

  try {
    const chromium = (await import('@sparticuz/chromium')).default;
    const executablePath = await chromium.executablePath();
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
