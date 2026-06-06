/**
 * 浏览器管理模块 — CloakBrowser（源码级隐身 Chromium）
 */
import { launch } from 'cloakbrowser';
import config from './config.js';

let browser = null;
let context = null;
let page = null;

/**
 * 启动浏览器
 *
 * CloakBrowser 在 Chromium 二进制层面修改指纹（UA、navigator.webdriver、
 * canvas/WebGL/字体等），无需再注入 JS 反检测脚本或伪造 User-Agent。
 */
export async function launchBrowser() {
  browser = await launch({
    headless: config.browser.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    extraHTTPHeaders: {
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
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
