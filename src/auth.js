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
async function loadSession(page, context) {
  try {
    if (!fs.existsSync(AUTH_STATE_PATH)) {
      console.log('📂 未找到 auth_state.json，需要登录');
      return false;
    }
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
export async function saveSession(context) {
  try {

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
export async function refreshSession(page, context) {
  try {
    await page.goto(config.urls.home, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(2000, 4000);

    // 访问后立即保存（服务端可能下发了新的 cookie）
    await saveSession(context);
    console.log('🔄 Session 续期完成');
  } catch (err) {
    console.error('⚠️ Session 续期失败:', err.message);
  }
}

/**
 * 检查是否已登录
 */
async function isLoggedIn(page, context) {
  try {
    await page.goto(config.urls.home, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(2000, 4000);

    // 未登录时侧栏渲染登录按钮 / un-loggedIn 标记。
    // 注意：不能用 [class*="avatar"] 判断登录——feed 里每条笔记的作者头像都带 avatar，未登录也存在，会造成误判。
    const loggedOut = await page.$('#login-btn, .side-bar-ai-un-loggedIn, .login-btn');
    if (loggedOut) {
      console.log('❌ 检测到登录按钮，未登录');
      return false;
    }

    // 被重定向到登录页也视为未登录
    if (page.url().includes('/login')) {
      console.log('❌ 已被重定向到登录页');
      return false;
    }

    console.log('✅ 登录状态有效');
    // 登录有效，立即保存最新 cookies（可能已被服务端续期）
    await saveSession(context);
    return true;
  } catch (err) {
    console.error('⚠️ 登录状态检查失败:', err.message);
    return false;
  }
}

/**
 * 执行登录流程（二维码截图 -> 飞书通知 -> 等待扫码）
 */
async function performLogin(page, context) {
  ensureScreenshotDir();

  console.log('🔐 开始登录流程...');
  await page.goto(config.urls.login, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await randomDelay(3000, 5000);

  // 尝试切换到二维码登录
  try {
    const qrTab = await page.$('[class*="qrcode"], [class*="QRCode"], .login-qrcode-tab')
      ?? await page.getByText('扫码登录').elementHandle().catch(() => null);
    if (qrTab) {
      await qrTab.click();
      await randomDelay(2000, 3000);
    }
  } catch {
    // 可能默认就是二维码页面
  }

  // 等待二维码出现
  await randomDelay(2000, 4000);

  // 截图二维码区域（固定文件名，避免积累）
  const screenshotPath = path.join(SCREENSHOTS_DIR, 'qrcode.png');

  // 尝试只截取二维码元素，否则截全页
  const qrEl = await page.$('[class*="qrcode"] img, [class*="QRCode"] img, canvas, [class*="qr-image"], .qrcode-img');
  if (qrEl) {
    await qrEl.screenshot({ path: screenshotPath });
  } else {
    await page.screenshot({ path: screenshotPath, fullPage: false });
  }
  console.log(`📸 二维码截图已保存: ${screenshotPath}`);

  // 在终端中显示二维码
  console.log('\n🔐 请使用小红书 APP 扫描以下二维码登录：\n');
  const qrImage = await terminalImage.file(screenshotPath, { width: '20%' });
  console.log(qrImage);
  console.log(`\n� 若终端显示不清晰，请直接打开截图文件: ${screenshotPath}\n`);

  // 轮询等待登录成功
  console.log('⏳ 等待扫码登录...');
  const maxWaitMs = 5 * 60 * 1000; // 最多等待 5 分钟
  const pollInterval = 5000;
  const startTime = Date.now();

  let pollCount = 0;
  while (Date.now() - startTime < maxWaitMs) {
    await randomDelay(pollInterval, pollInterval + 2000);
    pollCount++;

    // 检查页面是否已跳转（登录成功后会跳转）
    const currentUrl = page.url();
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`  ⏳ 第 ${pollCount} 次检测 (${elapsed}s)... URL: ${currentUrl}`);

    // 优先检查是否有需要绑定手机号等中间步骤（弹窗可能出现在首页上）
    console.log('    🔍 检查绑定手机号弹窗...');
    const bindPhone = await page.$('[class*="bind-phone"], [class*="bindPhone"], [class*="bind_phone"], [class*="verify-modal"], [class*="verification"]')
      ?? await page.getByText('绑定手机号').elementHandle({ timeout: 2000 }).catch(() => null)
      ?? await page.getByText('bind mobile number', { exact: false }).elementHandle({ timeout: 2000 }).catch(() => null)
      ?? await page.getByText('Enter mobile number').elementHandle({ timeout: 2000 }).catch(() => null)
      ?? await page.getByText('SMS verification code').elementHandle({ timeout: 2000 }).catch(() => null);
    if (bindPhone) {
      console.log('\n⚠️  检测到「绑定手机号」弹窗！');
      console.log('📱 请在浏览器中输入手机号和验证码完成绑定。');
      console.log('💡 提示：设置 HEADLESS=false 可以看到浏览器界面');
      console.log('⏳ 等待您完成手机号绑定...\n');
      // 不 return，继续轮询等待用户完成绑定
      continue;
    }

    if (!currentUrl.includes('/login') && !currentUrl.includes('/web/login')) {
      console.log('✅ 扫码登录成功！（页面已跳转）');
      await saveSession(context);
      return true;
    }

    // 检查页面内是否出现已登录的元素（有时URL不变但页面内容变了）
    console.log('    🔍 检查登录状态元素...');
    const loggedInIndicator = await page.$('.user-avatar, .side-bar .user, [class*="avatar"], .reds-account-info, [class*="login-success"]');
    if (loggedInIndicator) {
      console.log('✅ 扫码登录成功！（检测到用户元素）');
      await saveSession(context);
      return true;
    }

    // 检查二维码是否过期，过期则刷新
    console.log('    🔍 检查二维码是否过期...');
    const expired = await page.$('[class*="expired"]')
      ?? await page.getByText('二维码已过期').elementHandle({ timeout: 2000 }).catch(() => null)
      ?? await page.getByText('已过期').elementHandle({ timeout: 2000 }).catch(() => null);
    if (expired) {
      console.log('🔄 二维码已过期，刷新中...');
      const refreshBtn = await page.$('[class*="refresh"]')
        ?? await page.getByText('刷新').elementHandle({ timeout: 2000 }).catch(() => null)
        ?? await page.getByText('点击刷新').elementHandle({ timeout: 2000 }).catch(() => null);
      if (refreshBtn) {
        await refreshBtn.click();
        await randomDelay(3000, 5000);
        // 重新截图并在终端显示
        const qrElRefresh = await page.$('[class*="qrcode"] img, [class*="QRCode"] img, canvas, [class*="qr-image"], .qrcode-img');
        if (qrElRefresh) {
          await qrElRefresh.screenshot({ path: screenshotPath });
        } else {
          await page.screenshot({ path: screenshotPath, fullPage: false });
        }
        const refreshedImage = await terminalImage.file(screenshotPath, { width: '20%' });
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
export async function ensureAuthenticated(page, context) {
  // 1. 尝试加载已有 Session
  const loaded = await loadSession(page, context);

  if (loaded) {
    // 2. 验证 Session 是否有效
    const valid = await isLoggedIn(page, context);
    if (valid) {
      return true;
    }
    console.log('⚠️ Session 已过期，重新登录');
  }

  // 3. 执行登录
  return await performLogin(page, context);
}
