/**
 * 粉丝互动模块 — 主动去粉丝的帖子下评论，增进互动
 *
 * 流程：
 * 1. 进入消息中心，获取最近评论过我帖子的粉丝列表
 * 2. 逐个访问粉丝主页
 * 3. 浏览粉丝最新发布的笔记
 * 4. 调用 AI 生成针对粉丝笔记内容的评论
 * 5. 模拟真人操作留下评论
 */
import config from './config.js';
import { getPage } from './browser.js';
import { generateComment } from './ai.js';
import { randomDelay, humanTyping, humanClick, humanScroll, batchRest } from './human.js';
import { circuitBreaker } from './circuit-breaker.js';
import { scheduler } from './scheduler.js';
import { saveSession } from './auth.js';

/**
 * 已互动过的粉丝记录（本次运行内去重）
 */
const interactedFans = new Set();

/**
 * 从通知中心获取最近评论我帖子的粉丝列表
 * @returns {Array<{username, profileUrl}>}
 */
async function fetchRecentFans() {
  const page = getPage();
  const fans = [];

  console.log('📬 进入消息中心，获取最近互动的粉丝...');
  await randomDelay(2000, 5000);
  await page.goto(config.urls.notifications, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await randomDelay(3000, 6000);

  // 检查是否被重定向到登录页
  if (page.url().includes('/login')) {
    circuitBreaker.recordRedirect();
    throw new Error('被重定向到登录页，Session 可能失效');
  }

  // 尝试点击"评论和@"标签
  try {
    const commentTab = await page.$(
      'text=评论和@, text=评论, [class*="comment-tab"], [class*="Comment"]'
    );
    if (commentTab) {
      await commentTab.click();
      await randomDelay(2000, 4000);
    }
  } catch {
    console.log('ℹ️ 未找到评论标签，可能已在评论页');
  }

  // 等待通知列表加载
  await page.waitForSelector(
    '[class*="notification"], [class*="comment-item"], [class*="message-item"], [class*="notify-item"]',
    { timeout: 15000 }
  ).catch(() => null);

  await randomDelay(1000, 2000);

  // 滚动加载更多
  await humanScroll(page, 600);
  await randomDelay(1500, 3000);

  // 抓取粉丝信息
  const items = await page.$$(
    '[class*="notification-item"], [class*="comment-item"], [class*="message-item"], [class*="notify-item"]'
  );

  console.log(`📋 找到 ${items.length} 条通知项`);

  for (const item of items) {
    try {
      // 提取用户名和主页链接
      const userLink = await item.$(
        'a[href*="/user/"], [class*="username"] a, [class*="name"] a, [class*="nick"] a'
      );

      if (!userLink) continue;

      const username = (await userLink.textContent()).trim();
      const href = await userLink.getAttribute('href');

      if (!username || !href) continue;

      // 构建完整的用户主页 URL
      const profileUrl = href.startsWith('http')
        ? href
        : `${config.urls.home}${href}`;

      // 去重：本次运行内不重复访问同一粉丝
      if (interactedFans.has(username)) continue;

      fans.push({ username, profileUrl });
    } catch {
      continue;
    }
  }

  // 去重
  const uniqueFans = [...new Map(fans.map((f) => [f.username, f])).values()];
  console.log(`👥 筛选出 ${uniqueFans.length} 位待互动粉丝`);
  return uniqueFans;
}

/**
 * 访问粉丝主页，获取其最新笔记列表
 * @returns {Array<{noteUrl, noteTitle, notePreview}>}
 */
async function fetchFanNotes(fan) {
  const page = getPage();
  const notes = [];

  console.log(`\n👤 访问粉丝主页: @${fan.username}`);
  await randomDelay(3000, 8000);
  await page.goto(fan.profileUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await randomDelay(3000, 6000);

  // 检查频率限制
  if (await circuitBreaker.checkRateLimit(page)) {
    return notes;
  }

  // 检查重定向
  if (page.url().includes('/login')) {
    circuitBreaker.recordRedirect();
    return notes;
  }

  // 等待笔记列表加载
  await page.waitForSelector(
    '[class*="note-item"], [class*="cover"], section a[href*="/explore/"], section a[href*="/discovery/item/"]',
    { timeout: 10000 }
  ).catch(() => null);

  await randomDelay(1000, 2000);

  // 获取笔记卡片
  const noteCards = await page.$$(
    'section [class*="note-item"], [class*="note-card"], a[href*="/explore/"], a[href*="/discovery/item/"]'
  );

  // 只取最新的 3 篇笔记
  const recentCards = noteCards.slice(0, 3);

  for (const card of recentCards) {
    try {
      const titleEl = await card.$('[class*="title"], [class*="desc"], .note-title');
      const noteTitle = titleEl ? (await titleEl.textContent()).trim() : '';

      const linkEl = (await card.getAttribute('href'))
        ? card
        : await card.$('a[href]');

      let noteUrl = '';
      if (linkEl) {
        const href = await linkEl.getAttribute('href');
        noteUrl = href?.startsWith('http') ? href : `${config.urls.home}${href}`;
      }

      if (noteUrl) {
        notes.push({ noteUrl, noteTitle, notePreview: noteTitle });
      }
    } catch {
      continue;
    }
  }

  console.log(`📝 找到 ${notes.length} 篇笔记`);
  return notes;
}

/**
 * 进入笔记详情页并留下评论
 */
async function commentOnNote(fan, note) {
  const page = getPage();

  console.log(`  📖 打开笔记: "${note.noteTitle?.slice(0, 30) || note.noteUrl}"`);
  await randomDelay(3000, 8000);
  await page.goto(note.noteUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await randomDelay(3000, 6000);

  // 检查频率限制
  if (await circuitBreaker.checkRateLimit(page)) {
    return { commented: false, skipped: false, error: '频率限制' };
  }

  // 获取笔记正文内容用于 AI 理解上下文
  let noteContent = '';
  try {
    const contentEl = await page.$(
      '[class*="note-content"], [class*="desc"], [class*="content"], #detail-desc, .note-text'
    );
    if (contentEl) {
      noteContent = (await contentEl.textContent()).trim();
    }
    // 如果没有正文，尝试获取标题
    if (!noteContent) {
      const titleEl = await page.$(
        '[class*="note-title"], h1, [class*="title"]'
      );
      if (titleEl) {
        noteContent = (await titleEl.textContent()).trim();
      }
    }
  } catch {
    // 无法获取内容则跳过
  }

  if (!noteContent) {
    console.log('  ⏭️ 无法获取笔记内容，跳过');
    return { commented: false, skipped: true };
  }

  // 调用 AI 生成评论
  const comment = await generateComment(noteContent, fan.username);

  if (!comment) {
    console.log('  ⏭️ AI 决定不评论此笔记');
    return { commented: false, skipped: true };
  }

  // 找到评论输入区域并点击
  try {
    const commentInputTrigger = await page.$(
      '[class*="comment-input"], [class*="add-comment"], [placeholder*="评论"], [class*="input-box"], textarea, [contenteditable="true"]'
    );

    if (!commentInputTrigger) {
      console.log('  ⏭️ 未找到评论输入框');
      circuitBreaker.recordFailure();
      return { commented: false, skipped: false, error: '未找到评论框' };
    }

    // 点击激活评论框
    await randomDelay(2000, 5000);
    await commentInputTrigger.click();
    await randomDelay(1000, 2000);

    // 等待输入框激活
    const activeInput = await page.$(
      'textarea:focus, [contenteditable="true"]:focus, [class*="comment-input"] textarea, [class*="input"] textarea, [contenteditable="true"]'
    );

    const inputTarget = activeInput || commentInputTrigger;
    const inputSelector = activeInput
      ? 'textarea:focus, [contenteditable="true"]:focus, [class*="comment-input"] textarea'
      : '[class*="comment-input"], [placeholder*="评论"], textarea, [contenteditable="true"]';

    // 逐字输入
    await humanTyping(page, inputSelector, comment);
    await randomDelay(1500, 3000);

    // 点击发送
    const sendBtn = await page.$(
      '[class*="send"], [class*="submit"], button:has-text("发送"), button:has-text("发布"), [class*="publish"]'
    );

    if (sendBtn) {
      await randomDelay(1000, 3000);
      await sendBtn.click();
      await randomDelay(2000, 4000);
    } else {
      // 尝试 Ctrl+Enter 或 Enter 发送
      await page.keyboard.press('Enter');
      await randomDelay(2000, 4000);
    }

    // 发送后检查频率限制
    const hasRateLimit = await circuitBreaker.checkRateLimit(page);
    if (hasRateLimit) {
      return { commented: false, skipped: false, error: '触发频率限制' };
    }

    console.log(`  ✅ 成功评论 @${fan.username} 的笔记: "${comment.slice(0, 30)}..."`);
    circuitBreaker.recordSuccess();
    scheduler.recordReply();
    return { commented: true, skipped: false };
  } catch (err) {
    console.error(`  ❌ 评论失败:`, err.message);
    circuitBreaker.recordFailure();
    await page.keyboard.press('Escape').catch(() => { });
    return { commented: false, skipped: false, error: err.message };
  }
}

/**
 * 执行一轮粉丝互动
 * @returns {{commentedCount, skippedCount, errors}}
 */
export async function processInteractions() {
  const page = getPage();
  let commentedCount = 0;
  let skippedCount = 0;
  const errors = [];
  let batchCounter = 0;

  try {
    // 1. 获取最近互动的粉丝
    const fans = await fetchRecentFans();

    if (fans.length === 0) {
      console.log('📭 当前没有待互动的粉丝');
      return { commentedCount, skippedCount, errors };
    }

    // 2. 逐个粉丝处理
    for (const fan of fans) {
      // 检查熔断器
      if (await circuitBreaker.shouldTrip(page)) {
        console.error('🚨 熔断器已触发，停止处理');
        break;
      }

      // 检查每日上限
      if (scheduler.isLimitReached()) {
        console.log('📊 已达到每日评论上限，停止处理');
        break;
      }

      // 3. 获取粉丝的笔记
      const notes = await fetchFanNotes(fan);

      if (notes.length === 0) {
        console.log(`  📭 @${fan.username} 没有可评论的笔记`);
        skippedCount++;
        continue;
      }

      // 4. 只评论粉丝最新的 1 篇笔记（避免过度）
      const targetNote = notes[0];
      const result = await commentOnNote(fan, targetNote);

      if (result.commented) {
        commentedCount++;
        batchCounter++;
        interactedFans.add(fan.username);
      } else if (result.skipped) {
        skippedCount++;
      } else if (result.error) {
        errors.push(`@${fan.username}: ${result.error}`);
      }

      // 批处理间歇
      if (batchCounter >= config.limits.batchSize) {
        batchCounter = 0;
        await batchRest(config.limits.batchRestMinMinutes, config.limits.batchRestMaxMinutes);
      }

      // 每次互动后的随机等待（较长，模拟浏览行为）
      await randomDelay(8000, 20000);
    }

    // 保存 Session
    await saveSession();
  } catch (err) {
    console.error('❌ 粉丝互动异常:', err.message);
    errors.push(err.message);
  }

  return { commentedCount, skippedCount, errors };
}
