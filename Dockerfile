# ============================================================
# 小红书 AI 粉丝互动助手 - 多架构 Dockerfile
# 支持 linux/amd64 + linux/arm64 (R5S ARM)
# ============================================================
FROM node:22-slim AS base

# 安装 Playwright 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libnspr4 \
    libx11-xcb1 \
    libxcb1 \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制 package 文件
COPY package.json package-lock.json* ./

# 安装依赖
RUN npm ci --omit=dev

# 预下载 CloakBrowser 隐身 Chromium 二进制（支持当前架构）
RUN node -e "import('cloakbrowser').then(m => m.ensureBinary())"

# 复制源代码
COPY src/ ./src/

# 创建数据目录
RUN mkdir -p /app/data/screenshots && \
    chown -R node:node /app/data

# 不以 root 运行
USER node

# 数据卷
VOLUME ["/app/data"]

CMD ["node", "src/index.js"]
