/**
 * 登录与 Session 管理模块
 */
import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';
import { getContext, getPage } from './browser.js';
import { randomDelay } from './human.js';
import { sendText, sendImage } from './feishu.js';

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
 * 加载已保存的 Session
 * @returns {boolean} 是否成功加载
 */
export async function loadSession() {
  try {
    if (!fs.existsSync(AUTH_STATE_PATH)) {
      console.log('📂 未找到 auth_state.json，需要登录');
      return false;
    }

    const context = getContext();
    const stateData = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf-8'));

    // 恢复 cookies
    if (stateData.cookies?.length) {
      await context.addCookies(stateData.cookies);
      console.log(`🍪 已加载 ${stateData.cookies.length} 个 cookies`);
    }

    return true;
  } catch (err) {
    console.error('⚠️ Session 加载失败:', err.message);
    return false;
  }
}

/**
 * 保存当前 Session
 */
export async function saveSession() {
  try {
    const context = getContext();
    const cookies = await context.cookies();
    const stateData = {
      cookies,
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(AUTH_STATE_PATH, JSON.stringify(stateData, null, 2));
    console.log('💾 Session 已保存');
  } catch (err) {
    console.error('❌ Session 保存失败:', err.message);
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

  // 通过飞书发送截图通知
  await sendImage(screenshotPath);
  await sendText('🔐 小红书需要登录！请打开小红书 APP 扫描二维码登录。脚本正在等待中...');

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
      await sendText('✅ 小红书登录成功！开始运行互动任务。');
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
        // 重新截图
        await page.screenshot({ path: screenshotPath, fullPage: false });
        await sendImage(screenshotPath);
        await sendText('🔄 二维码已刷新，请重新扫码。');
      }
    }
  }

  console.error('❌ 登录超时（5 分钟内未完成扫码）');
  await sendText('❌ 小红书登录超时！请检查后重启脚本。');
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
