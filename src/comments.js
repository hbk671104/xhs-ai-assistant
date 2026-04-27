/**
 * 评论互动模块 — 抓取未读评论并自动回复
 */
import config from './config.js';
import { getPage } from './browser.js';
import { generateReply } from './ai.js';
import { randomDelay, humanTyping, humanClick, humanScroll, batchRest } from './human.js';
import { circuitBreaker } from './circuit-breaker.js';
import { scheduler } from './scheduler.js';
import { saveSession } from './auth.js';

/**
 * 导航到评论通知页面
 */
async function navigateToComments() {
  const page = getPage();
  console.log('📬 进入消息中心 - 评论页...');

  await randomDelay(2000, 5000);
  await page.goto(config.urls.notifications, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await randomDelay(3000, 6000);

  // 检查是否需要重新登录
  if (page.url().includes('/login')) {
    circuitBreaker.recordRedirect();
    throw new Error('被重定向到登录页，Session 可能失效');
  }

  // 尝试点击"评论"标签
  try {
    const commentTab = await page.$(
      '[class*="comment"], [class*="Comment"], text=评论和@, text=评论'
    );
    if (commentTab) {
      await humanClick(page, '[class*="comment"], [class*="Comment"], text=评论和@, text=评论', {
        minDelay: 1000,
        maxDelay: 3000,
      });
      await randomDelay(2000, 4000);
    }
  } catch {
    console.log('ℹ️ 未找到评论标签，可能已在评论页');
  }
}

/**
 * 抓取页面上的未读评论列表
 * @returns {Array<{element, username, content, noteTitle}>}
 */
async function fetchUnreadComments() {
  const page = getPage();
  const comments = [];

  try {
    // 等待评论列表加载
    await page.waitForSelector(
      '[class*="notification"], [class*="comment-item"], [class*="message-item"], .note-comment',
      { timeout: 15000 }
    ).catch(() => null);

    await randomDelay(1000, 2000);

    // 抓取所有评论项
    const commentItems = await page.$$(
      '[class*="notification-item"], [class*="comment-item"], [class*="message-item"], [class*="notify-item"]'
    );

    console.log(`📋 找到 ${commentItems.length} 条通知项`);

    for (const item of commentItems) {
      try {
        // 提取用户名
        const usernameEl = await item.$(
          '[class*="username"], [class*="name"], [class*="nick"], .author-name'
        );
        const username = usernameEl ? (await usernameEl.textContent()).trim() : '未知用户';

        // 提取评论内容
        const contentEl = await item.$(
          '[class*="content"], [class*="desc"], [class*="comment-text"], .comment-content'
        );
        const content = contentEl ? (await contentEl.textContent()).trim() : '';

        // 提取笔记标题
        const noteTitleEl = await item.$(
          '[class*="note-title"], [class*="title"], .note-name'
        );
        const noteTitle = noteTitleEl ? (await noteTitleEl.textContent()).trim() : '';

        // 检查是否有回复按钮（表示未回复）
        const replyBtn = await item.$(
          '[class*="reply"], text=回复, button:has-text("回复")'
        );

        if (content && replyBtn) {
          comments.push({
            element: item,
            replyBtn,
            username,
            content,
            noteTitle,
          });
        }
      } catch {
        // 单条评论解析失败，跳过
        continue;
      }
    }
  } catch (err) {
    console.error('❌ 评论抓取失败:', err.message);
    circuitBreaker.recordFailure();
  }

  console.log(`💬 筛选出 ${comments.length} 条待回复评论`);
  return comments;
}

/**
 * 回复单条评论
 */
async function replyToComment(comment) {
  const page = getPage();
  const { element, replyBtn, username, content, noteTitle } = comment;

  console.log(`\n💬 处理评论 - @${username}: "${content.slice(0, 50)}..."`);

  // 1. 调用 AI 生成回复
  const reply = await generateReply(content, noteTitle);

  // 2. 智能过滤：空字符串表示跳过
  if (!reply) {
    console.log(`⏭️ AI 决定跳过此评论（广告/无意义/辱骂）`);
    return { replied: false, skipped: true };
  }

  // 3. 点击回复按钮
  try {
    await humanClick(page, '', { minDelay: 2000, maxDelay: 5000 });
    // 直接点击找到的按钮元素
    await replyBtn.click();
    await randomDelay(1000, 2000);
  } catch (err) {
    console.error('❌ 点击回复按钮失败:', err.message);
    circuitBreaker.recordFailure();
    return { replied: false, skipped: false, error: err.message };
  }

  // 4. 找到输入框并模拟输入
  try {
    // 等待回复输入框出现
    const inputSelector =
      '[class*="reply-input"], [class*="comment-input"], textarea, [contenteditable="true"], input[type="text"]';
    await page.waitForSelector(inputSelector, { timeout: 5000 });
    await randomDelay(500, 1000);

    // 逐字输入
    await humanTyping(page, inputSelector, reply);
    await randomDelay(1000, 2000);

    // 5. 点击发送
    const sendBtn = await page.$(
      '[class*="send"], [class*="submit"], button:has-text("发送"), button:has-text("回复")'
    );

    if (sendBtn) {
      await randomDelay(1000, 3000);
      await sendBtn.click();
      await randomDelay(2000, 4000);

      // 检查发送后的页面状态
      const hasRateLimit = await circuitBreaker.checkRateLimit(page);
      if (hasRateLimit) {
        return { replied: false, skipped: false, error: '触发频率限制' };
      }

      console.log(`✅ 成功回复 @${username}: "${reply.slice(0, 30)}..."`);
      circuitBreaker.recordSuccess();
      scheduler.recordReply();

      return { replied: true, skipped: false };
    } else {
      // 尝试按 Enter 发送
      await page.keyboard.press('Enter');
      await randomDelay(2000, 4000);

      console.log(`✅ 成功回复（Enter发送）@${username}: "${reply.slice(0, 30)}..."`);
      circuitBreaker.recordSuccess();
      scheduler.recordReply();

      return { replied: true, skipped: false };
    }
  } catch (err) {
    console.error('❌ 回复输入/发送失败:', err.message);
    circuitBreaker.recordFailure();
    // 按 Escape 关闭可能打开的输入框
    await page.keyboard.press('Escape').catch(() => { });
    return { replied: false, skipped: false, error: err.message };
  }
}

/**
 * 执行一轮评论互动
 * @returns {{repliedCount, skippedCount, errors}}
 */
export async function processComments() {
  const page = getPage();
  let repliedCount = 0;
  let skippedCount = 0;
  const errors = [];
  let batchCounter = 0;

  try {
    // 导航到评论页
    await navigateToComments();

    // 向下滚动加载更多
    await humanScroll(page, 500);
    await randomDelay(1000, 2000);

    // 获取未读评论
    const comments = await fetchUnreadComments();

    if (comments.length === 0) {
      console.log('📭 当前没有需要回复的评论');
      return { repliedCount, skippedCount, errors };
    }

    for (const comment of comments) {
      // 检查熔断器
      if (await circuitBreaker.shouldTrip(page)) {
        console.error('🚨 熔断器已触发，停止处理');
        break;
      }

      // 检查每日上限
      if (scheduler.isLimitReached()) {
        console.log('📊 已达到每日回复上限，停止处理');
        break;
      }

      // 处理评论
      const result = await replyToComment(comment);

      if (result.replied) {
        repliedCount++;
        batchCounter++;
      } else if (result.skipped) {
        skippedCount++;
      } else if (result.error) {
        errors.push(result.error);
      }

      // 批处理间歇
      if (batchCounter >= config.limits.batchSize) {
        batchCounter = 0;
        await batchRest(config.limits.batchRestMinMinutes, config.limits.batchRestMaxMinutes);
      }

      // 每次回复后的随机等待
      await randomDelay(5000, 15000);
    }

    // 定期保存 Session
    await saveSession();
  } catch (err) {
    console.error('❌ 评论处理异常:', err.message);
    errors.push(err.message);
  }

  return { repliedCount, skippedCount, errors };
}
