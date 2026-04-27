/**
 * 登录与 Session 管理模块
 *
 * 策略：扫一次码，尽可能永久保持登录态
 * 1. 使用 storageState 保存完整状态（cookies + localStorage）
 * 2. 每次页面操作后即时保存最新 cookies（服务端可能续期）
 * 3. 每轮开始前主动访问首页触发 token 续命
 * 4. 登录后将所有 cookie 过期时间延长（浏览器侧）
 */
import fs from 'node:fs';
import path from 'node:path';
import terminalImage from 'terminal-image';
import config from './config.js';
import { getContext, getPage } from './browser.js';
import { randomDelay } from './human.js';

const AUTH_STATE_PATH = config.paths.authState;
const SCREENSHOTS_DIR = config.paths.screenshots;

/**
 * 确保截图目录存在
 */
function ensureScreenshotDir() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }
}

/**
 * 加载已保存的 Session（cookies + localStorage）
 * @returns {boolean} 是否成功加载
 */
export async function loadSession() {
  try {
    if (!fs.existsSync(AUTH_STATE_PATH)) {
      console.log('📂 未找到 auth_state.json，需要登录');
      return false;
    }

    const context = getContext();
    const page = getPage();
    const stateData = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf-8'));

    // 恢复 cookies（延长过期时间）
    if (stateData.cookies?.length) {
      const extendedCookies = extendCookieExpiry(stateData.cookies);
      await context.addCookies(extendedCookies);
      console.log(`🍪 已加载 ${extendedCookies.length} 个 cookies`);
    }

    // 恢复 localStorage
    if (stateData.origins?.length) {
      for (const origin of stateData.origins) {
        if (origin.localStorage?.length) {
          await page.goto(origin.origin, { waitUntil: 'commit', timeout: 15000 }).catch(() => { });
          await page.evaluate((items) => {
            for (const { name, value } of items) {
              try { localStorage.setItem(name, value); } catch { }
            }
          }, origin.localStorage);
          console.log(`📦 已恢复 localStorage (${origin.localStorage.length} 项) for ${origin.origin}`);
        }
      }
    }

    return true;
  } catch (err) {
    console.error('⚠️ Session 加载失败:', err.message);
    return false;
  }
}

/**
 * 保存当前完整 Session（cookies + localStorage）
 * 每次调用都会覆盖保存，确保拿到最新续期后的 token
 */
export async function saveSession() {
  try {
    const context = getContext();

    // storageState() 会同时获取 cookies 和 localStorage
    const state = await context.storageState();

    // 额外记录保存时间
    state.savedAt = new Date().toISOString();

    fs.writeFileSync(AUTH_STATE_PATH, JSON.stringify(state, null, 2));
    console.log('💾 Session 已保存（cookies + localStorage）');
  } catch (err) {
    console.error('❌ Session 保存失败:', err.message);
  }
}

/**
 * 延长 cookie 过期时间（浏览器侧强制续期）
 * 将所有 cookie 的 expires 设置为 1 年后
 */
function extendCookieExpiry(cookies) {
  const oneYearFromNow = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

  return cookies.map((cookie) => {
    const extended = { ...cookie };
    // 对有过期时间的 cookie 延长到 1 年后
    if (extended.expires && extended.expires > 0) {
      extended.expires = oneYearFromNow;
    }
    return extended;
  });
}

/**
 * 主动续期：访问首页触发服务端 cookie 刷新
 */
export async function refreshSession() {
  const page = getPage();
  try {
    await page.goto(config.urls.home, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(2000, 4000);

    // 访问后立即保存（服务端可能下发了新的 cookie）
    await saveSession();
    console.log('🔄 Session 续期完成');
  } catch (err) {
    console.error('⚠️ Session 续期失败:', err.message);
  }
}

/**
 * 检查是否已登录
 */
export async function isLoggedIn() {
  const page = getPage();
  try {
    await page.goto(config.urls.home, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(2000, 4000);

    // 检查是否存在登录态标识（头像或用户菜单）
    const userAvatar = await page.$('.user-avatar, .side-bar .user, [class*="avatar"], .reds-account-info');
    if (userAvatar) {
      console.log('✅ 登录状态有效');
      // 登录有效，立即保存最新 cookies（可能已被服务端续期）
      await saveSession();
      return true;
    }

    // 检查是否被重定向到登录页
    if (page.url().includes('/login')) {
      console.log('❌ 已被重定向到登录页');
      return false;
    }

    // 尝试访问消息中心确认登录
    await page.goto(config.urls.notifications, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(2000, 3000);

    if (page.url().includes('/login')) {
      console.log('❌ 消息中心需要登录');
      return false;
    }

    console.log('✅ 登录状态有效（通过消息中心确认）');
    await saveSession();
    return true;
  } catch (err) {
    console.error('⚠️ 登录状态检查失败:', err.message);
    return false;
  }
}

/**
 * 执行登录流程（二维码截图 -> 飞书通知 -> 等待扫码）
 */
export async function performLogin() {
  const page = getPage();
  ensureScreenshotDir();

  console.log('🔐 开始登录流程...');
  await page.goto(config.urls.login, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await randomDelay(3000, 5000);

  // 尝试切换到二维码登录
  try {
    const qrTab = await page.$('[class*="qrcode"], [class*="QRCode"], .login-qrcode-tab, text=扫码登录');
    if (qrTab) {
      await qrTab.click();
      await randomDelay(2000, 3000);
    }
  } catch {
    // 可能默认就是二维码页面
  }

  // 等待二维码出现
  await randomDelay(2000, 4000);

  // 截图二维码
  const screenshotPath = path.join(SCREENSHOTS_DIR, `qrcode_${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`📸 二维码截图已保存: ${screenshotPath}`);

  // 在终端中显示二维码
  const qrImage = await terminalImage.file(screenshotPath, { width: '50%' });
  console.log('\n🔐 请使用小红书 APP 扫描以下二维码登录：\n');
  console.log(qrImage);
  console.log('⏳ 等待扫码中...\n');

  // 轮询等待登录成功
  console.log('⏳ 等待扫码登录...');
  const maxWaitMs = 5 * 60 * 1000; // 最多等待 5 分钟
  const pollInterval = 5000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    await randomDelay(pollInterval, pollInterval + 2000);

    // 检查页面是否已跳转（登录成功后会跳转）
    const currentUrl = page.url();
    if (!currentUrl.includes('/login')) {
      console.log('✅ 扫码登录成功！');
      await saveSession();
      return true;
    }

    // 检查二维码是否过期，过期则刷新
    const expired = await page.$('[class*="expired"], text=二维码已过期, text=已过期');
    if (expired) {
      console.log('🔄 二维码已过期，刷新中...');
      const refreshBtn = await page.$('[class*="refresh"], text=刷新, text=点击刷新');
      if (refreshBtn) {
        await refreshBtn.click();
        await randomDelay(3000, 5000);
        // 重新截图并在终端显示
        await page.screenshot({ path: screenshotPath, fullPage: false });
        const refreshedImage = await terminalImage.file(screenshotPath, { width: '50%' });
        console.log('\n🔄 二维码已刷新，请重新扫码：\n');
        console.log(refreshedImage);
      }
    }
  }

  console.error('❌ 登录超时（5 分钟内未完成扫码）');
  return false;
}

/**
 * 完整的鉴权流程
 */
export async function ensureAuthenticated() {
  // 1. 尝试加载已有 Session
  const loaded = await loadSession();

  if (loaded) {
    // 2. 验证 Session 是否有效
    const valid = await isLoggedIn();
    if (valid) {
      return true;
    }
    console.log('⚠️ Session 已过期，重新登录');
  }

  // 3. 执行登录
  return await performLogin();
}
