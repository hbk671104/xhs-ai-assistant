import 'dotenv/config';

const config = {
  // DeepSeek API
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
  },

  // 飞书 Webhook
  feishu: {
    webhookUrl: process.env.FEISHU_WEBHOOK_URL,
  },

  // 运行限制
  limits: {
    dailyReplyMin: parseInt(process.env.DAILY_REPLY_MIN || '40', 10),
    dailyReplyMax: parseInt(process.env.DAILY_REPLY_MAX || '50', 10),
    activeHourStart: parseInt(process.env.ACTIVE_HOUR_START || '9', 10),
    activeHourEnd: parseInt(process.env.ACTIVE_HOUR_END || '23', 10),
    batchSize: parseInt(process.env.BATCH_SIZE || '5', 10),
    batchRestMinMinutes: parseInt(process.env.BATCH_REST_MIN_MINUTES || '10', 10),
    batchRestMaxMinutes: parseInt(process.env.BATCH_REST_MAX_MINUTES || '15', 10),
  },

  // 浏览器
  browser: {
    headless: process.env.HEADLESS !== 'false',
    dataDir: process.env.BROWSER_DATA_DIR || './data',
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
    notifications: 'https://www.xiaohongshu.com/notifications',
    commentNotifications: 'https://www.xiaohongshu.com/notifications/comments',
  },
};

// 校验必要配置
const required = [
  ['DEEPSEEK_API_KEY', config.deepseek.apiKey],
  ['FEISHU_WEBHOOK_URL', config.feishu.webhookUrl],
];

for (const [name, value] of required) {
  if (!value) {
    console.error(`❌ 缺少必要环境变量: ${name}，请在 .env 文件中配置`);
    process.exit(1);
  }
}

export default config;
