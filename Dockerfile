# syntax=docker/dockerfile:1
# ============================================================
# Dockerfile — chạy được trên BẤT KỲ VPS nào có sẵn Docker
# (Ubuntu/Debian/CentOS/Alpine host đều như nhau, vì mọi thứ chạy TRONG
# container, không phụ thuộc gói hệ điều hành của máy chủ thật).
#
# 2 giai đoạn:
#   1) "builder": cài devDependencies + build Next.js (output: 'standalone'
#      đã bật sẵn ở next.config.js -> .next/standalone/server.js tự chứa
#      hết dependencies cần cho lúc chạy, không cần node_modules đầy đủ ở
#      image cuối).
#   2) "runner": image gọn, chỉ copy đúng phần standalone + cài Chromium hệ
#      thống (thay cho @sparticuz/chromium-min vốn CHỈ dành cho môi trường
#      Lambda/Vercel — xem chú thích trong src/utils/browserFetch.js) rồi
#      set CHROME_EXECUTABLE_PATH trỏ vào đó. browserFetch.js đã tự ưu tiên
#      biến này (process.env.CHROME_EXECUTABLE_PATH || ...) nên KHÔNG cần
#      sửa code, chỉ cần set đúng biến môi trường này ở image/VPS.
# ============================================================

FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Build không cần gọi ra mạng ngoài (các domain nguồn/BASE_URL chỉ dùng lúc
# CHẠY, không dùng lúc build) -> không cần khai báo env gì ở bước này.
RUN npm run build


FROM node:20-bookworm-slim AS runner
WORKDIR /app

# Chromium hệ thống (thay cho bản tải riêng cho Lambda) + đúng bộ thư viện
# .so thường thiếu trên image "slim" (libnss3, fonts...) mà Chromium cần để
# chạy được ở chế độ headless.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      libnss3 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcups2 \
      libdrm2 \
      libgbm1 \
      libxkbcommon0 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxrandr2 \
      libasound2 \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV CHROME_EXECUTABLE_PATH=/usr/bin/chromium
# Next.js standalone server.js tự đọc PORT/HOSTNAME từ env — 0.0.0.0 để
# nhận request từ ngoài container (không chỉ localhost bên trong).
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Chạy bằng user thường (không phải root) — thói quen bảo mật cơ bản khi
# chạy container public trên VPS.
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
