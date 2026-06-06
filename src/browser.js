/**
 * 浏览器管理模块 — CloakBrowser（源码级隐身 Chromium）
 */
import { launchContext } from 'cloakbrowser';
import config from './config.js';

let context = null;
let page = null;

/**
 * 启动浏览器
 *
 * CloakBrowser 在 Chromium 二进制层面修改指纹（UA、navigator.webdriver、
 * canvas/WebGL/字体等），无需再注入 JS 反检测脚本或伪造 User-Agent。
 *
 * 关键点：
 * - locale/timezone 通过顶层字段传入，走二进制 flag（不可检测）。
 *   若放在 newContext，会触发可被检测的 CDP emulation。
 * - humanize: 启用类人鼠标曲线/打字/滚动，patch 所有交互方法。
 * - humanPreset 'careful': 更慢更谨慎，降低风控风险。
 * - 关闭 context 即关闭浏览器（launchContext 行为）。
 */
export async function launchBrowser() {
  context = await launchContext({
    headless: config.browser.headless,
    humanize: true,
    humanPreset: 'careful',
    locale: 'zh-CN',
    timezone: 'Asia/Shanghai',
    viewport: { width: 1440, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    // 可选：固定指纹种子，保证账号设备身份跨运行稳定
    ...(config.browser.fingerprintSeed
      ? { args: ['--no-sandbox', '--disable-setuid-sandbox', `--fingerprint=${config.browser.fingerprintSeed}`], stealthArgs: false }
      : {}),
    // 可选：住宅代理（数据中心 IP 易被风控）
    ...(config.browser.proxy ? { proxy: config.browser.proxy } : {}),
    contextOptions: {
      extraHTTPHeaders: {
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    },
  });

  page = await context.newPage();
  return { context, page };
}

/**
 * 关闭浏览器
 */
export async function closeBrowser() {
  if (context) {
    await context.close(); // 同时关闭底层浏览器
    context = null;
    page = null;
    console.log('🔒 浏览器已关闭');
  }
}
