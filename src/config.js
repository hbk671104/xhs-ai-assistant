import 'dotenv/config';

const config = {
  // 豆包 (火山引擎) API
  doubao: {
    apiKey: process.env.DOUBAO_API_KEY,
    baseUrl: process.env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
    // 模型家族：启动时查 /models，自动选用该家族日期最新的版本（lite 多模态）
    modelFamily: process.env.DOUBAO_MODEL_FAMILY || 'doubao-seed-2-0-lite',
    // 兜底型号：/models 查询失败或无匹配时使用
    fallbackModel: process.env.DOUBAO_FALLBACK_MODEL || 'doubao-seed-2-0-lite-260428',
  },

  // 运行限制
  limits: {
    dailyReplyMin: parseInt(process.env.DAILY_REPLY_MIN || '3', 10),
    dailyReplyMax: parseInt(process.env.DAILY_REPLY_MAX || '8', 10),
    activeHourStart: parseInt(process.env.ACTIVE_HOUR_START || '8', 10),
    activeHourEnd: parseInt(process.env.ACTIVE_HOUR_END || '22', 10),
    batchSize: parseInt(process.env.BATCH_SIZE || '3', 10),
    batchRestMinMinutes: parseInt(process.env.BATCH_REST_MIN_MINUTES || '10', 10),
    batchRestMaxMinutes: parseInt(process.env.BATCH_REST_MAX_MINUTES || '15', 10),
  },

  // 浏览器
  browser: {
    headless: process.env.HEADLESS !== 'false',
    dataDir: process.env.BROWSER_DATA_DIR || './data',
    // 住宅代理（可选）：http://user:pass@host:port 或 socks5://...
    proxy: process.env.XHS_PROXY || undefined,
    // 固定指纹种子（可选）：保证账号设备身份跨运行稳定，降低风控
    fingerprintSeed: process.env.XHS_FINGERPRINT_SEED || undefined,
  },

  // 路径
  paths: {
    authState: './data/auth_state.json',
    screenshots: './data/screenshots',
  },

  // 小红书 URL
  urls: {
    home: 'https://www.xiaohongshu.com',
    login: 'https://www.xiaohongshu.com/login',
    // 注意：消息中心是单数 /notification，复数 /notifications 会 404
    notifications: 'https://www.xiaohongshu.com/notification',
  },
};

// 校验必要配置
const required = [
  ['DOUBAO_API_KEY', config.doubao.apiKey],
];

for (const [name, value] of required) {
  if (!value) {
    console.error(`❌ 缺少必要环境变量: ${name}，请在 .env 文件中配置`);
    process.exit(1);
  }
}

export default config;
