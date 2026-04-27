/**
 * 浏览器管理模块 — Playwright + Stealth
 */
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import config from './config.js';
import { getRandomUserAgent } from './human.js';

// 注册 stealth 插件
chromium.use(StealthPlugin());

let browser = null;
let context = null;
let page = null;

/**
 * 启动浏览器
 */
export async function launchBrowser() {
  const userAgent = getRandomUserAgent();
  console.log(`🌐 User-Agent: ${userAgent.slice(0, 60)}...`);

  browser = await chromium.launch({
    headless: config.browser.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1440,900',
    ],
  });

  context = await browser.newContext({
    userAgent,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    // 额外的浏览器指纹伪装
    extraHTTPHeaders: {
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  });

  // 注入额外的反检测脚本
  await context.addInitScript(() => {
    // 覆盖 navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    // 覆盖 chrome 属性
    window.chrome = {
      runtime: {},
      loadTimes: function () { },
      csi: function () { },
      app: {},
    };
    // 覆盖 permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);
    // 覆盖 plugins 长度
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh', 'en'],
    });
  });

  page = await context.newPage();
  return { browser, context, page };
}

/**
 * 关闭浏览器
 */
export async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    context = null;
    page = null;
    console.log('🔒 浏览器已关闭');
  }
}
