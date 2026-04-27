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
import fs from 'node:fs';
import config from './config.js';
import { generateComment } from './ai.js';
import { randomDelay, humanTyping, humanScroll, batchRest } from './human.js';
import { circuitBreaker } from './circuit-breaker.js';
import { scheduler } from './scheduler.js';

/**
 * 已互动过的粉丝记录（本次运行内去重）
 */
const interactedFans = new Set();

/**
 * 已评论过的笔记 URL 持久化文件路径
 */
const COMMENTED_NOTES_PATH = './data/commented_notes.json';

/**
 * 已评论过的笔记 URL（跨运行持久化）
 */
const commentedNotes = loadCommentedNotes();

function loadCommentedNotes() {
  try {
    if (fs.existsSync(COMMENTED_NOTES_PATH)) {
      const data = JSON.parse(fs.readFileSync(COMMENTED_NOTES_PATH, 'utf-8'));
      console.log(`📚 已加载 ${data.length} 条历史评论记录`);
      return new Set(data);
    }
  } catch (err) {
    console.error('⚠️ 加载评论记录失败:', err.message);
  }
  return new Set();
}

function saveCommentedNotes() {
  try {
    // 只保留最近 500 条，避免文件无限增长
    const arr = [...commentedNotes].slice(-500);
    fs.writeFileSync(COMMENTED_NOTES_PATH, JSON.stringify(arr, null, 2));
  } catch (err) {
    console.error('⚠️ 保存评论记录失败:', err.message);
  }
}

/**
 * 从通知中心获取最近评论我帖子的粉丝列表
 * @returns {Array<{username, profileUrl}>}
 */
export async function fetchRecentFans(page) {
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
export async function fetchFanNotes(page, fan) {
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

  // 滚动加载更多笔记
  await humanScroll(page, 800);
  await randomDelay(1500, 3000);

  // 获取笔记卡片（取更多，兼顾最新和热门）
  const noteCards = await page.$$(
    'section [class*="note-item"], [class*="note-card"], a[href*="/explore/"], a[href*="/discovery/item/"]'
  );

  // 取前 10 篇候选笔记
  const candidateCards = noteCards.slice(0, 10);

  for (const card of candidateCards) {
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

      // 提取点赞数（小红书卡片上通常有 ❤️ 数字）
      let likes = 0;
      try {
        const likeEl = await card.$('[class*="like"], [class*="count"], [class*="heart"], [class*="engagement"], .like-wrapper span, .count');
        if (likeEl) {
          const likeText = (await likeEl.textContent()).trim();
          // 处理 "1.2万" / "1.2w" 格式
          if (likeText.includes('万') || likeText.toLowerCase().includes('w')) {
            likes = Math.round(parseFloat(likeText) * 10000);
          } else {
            likes = parseInt(likeText.replace(/[^\d]/g, ''), 10) || 0;
          }
        }
      } catch {
        // 无法提取点赞数，默认 0
      }

      if (noteUrl) {
        notes.push({ noteUrl, noteTitle, notePreview: noteTitle, likes });
      }
    } catch {
      continue;
    }
  }

  console.log(`📝 找到 ${notes.length} 篇笔记`);

  // 过滤已评论过的笔记
  const newNotes = notes.filter((n) => !commentedNotes.has(n.noteUrl));
  if (newNotes.length < notes.length) {
    console.log(`  🔍 过滤已评论的笔记，剩余 ${newNotes.length} 篇未评论`);
  }

  // 按点赞数降序排列，优先评论热度高的帖子
  newNotes.sort((a, b) => b.likes - a.likes);
  if (newNotes.length > 0 && newNotes[0].likes > 0) {
    console.log(`  🔥 最热笔记: "${newNotes[0].noteTitle?.slice(0, 20) || '无标题'}" (${newNotes[0].likes} 赞)`);
  }
  return newNotes;
}

/**
 * 进入笔记详情页并留下评论
 */
export async function commentOnNote(page, fan, note) {

  console.log(`  📖 打开笔记: "${note.noteTitle?.slice(0, 30) || note.noteUrl}"`);
  await randomDelay(3000, 8000);
  await page.goto(note.noteUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await randomDelay(3000, 6000);

  // 检查是否已评论过此笔记（本次运行内）
  if (commentedNotes.has(note.noteUrl)) {
    console.log('  ⏭️ 本轮已评论过此笔记，跳过');
    return { commented: false, skipped: true };
  }

  // 检查频率限制
  if (await circuitBreaker.checkRateLimit(page)) {
    return { commented: false, skipped: false, error: '频率限制' };
  }

  // 检查页面上是否已有自己的评论（跨运行去重）
  try {
    // 小红书笔记详情页中，自己的评论会带有删除/举报按钮等标识
    const ownComment = await page.$(
      '[class*="comment"] [class*="delete"], [class*="comment"] [class*="del"], [class*="comment-item"] [class*="author-tag"], [class*="comment"] [class*="is-author"]'
    );
    if (ownComment) {
      console.log('  ⏭️ 检测到已评论过此笔记，跳过');
      if (!commentedNotes.has(note.noteUrl)) {
        commentedNotes.add(note.noteUrl);
        saveCommentedNotes();
        console.log('  💾 已补录到评论记录');
      }
      return { commented: false, skipped: true };
    }
  } catch {
    // 检测失败不影响主流程
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

  // 提取笔记中的图片（base64）用于多模态 AI 分析
  const imageBase64List = [];
  try {
    // 小红书笔记详情页的图片（轮播图/单图）
    const imgEls = await page.$$(
      '[class*="note-content"] img, [class*="slide"] img, [class*="carousel"] img, [class*="swiper"] img, .note-detail img, [class*="image-container"] img'
    );
    // 最多取前 3 张图片，避免 token 过多
    const targetImgs = imgEls.slice(0, 3);
    for (const img of targetImgs) {
      try {
        // 确保图片已加载
        const isLoaded = await img.evaluate((el) => el.complete && el.naturalWidth > 0);
        if (!isLoaded) continue;

        // 用 Playwright screenshot 截图（避免跨域问题），压缩质量
        const buffer = await img.screenshot({ type: 'jpeg', quality: 50 });
        const b64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
        imageBase64List.push(b64);
      } catch {
        continue;
      }
    }

    // 如果没有找到图片，尝试截取视频封面/当前帧
    if (imageBase64List.length === 0) {
      const videoEl = await page.$(
        'video, [class*="video-player"], [class*="player-container"], [class*="video"] video'
      );
      if (videoEl) {
        try {
          const buffer = await videoEl.screenshot({ type: 'jpeg', quality: 50 });
          const b64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
          imageBase64List.push(b64);
          console.log('  🎬 已截取视频当前帧');
        } catch {
          // 视频截图失败不影响流程
        }
      }
    }

    if (imageBase64List.length > 0) {
      const totalKB = Math.round(imageBase64List.reduce((sum, b) => sum + b.length, 0) * 0.75 / 1024);
      console.log(`  🖼️ 提取到 ${imageBase64List.length} 张图片（压缩后约 ${totalKB}KB）`);
    }
  } catch {
    // 图片提取失败不影响主流程
  }

  // 文字和图片都没有才跳过
  if (!noteContent && imageBase64List.length === 0) {
    console.log('  ⏭️ 无法获取笔记内容（文字和图片均无），跳过');
    return { commented: false, skipped: true };
  }

  // 调用 AI 生成评论（传入图片列表）
  const comment = await generateComment(noteContent || '（无文字，请根据图片内容评论）', fan.username, imageBase64List);

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
    commentedNotes.add(note.noteUrl);
    saveCommentedNotes();
    circuitBreaker.recordSuccess();
    scheduler.recordReply();

    return { commented: true, skipped: false, comment, noteTitle: note.noteTitle };
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
export async function processInteractions(page) {
  let commentedCount = 0;
  let skippedCount = 0;
  const errors = [];
  const details = []; // 互动明细：{fan, noteTitle, comment}
  let batchCounter = 0;

  try {
    // 1. 获取最近互动的粉丝
    const fans = await fetchRecentFans(page);

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
      const notes = await fetchFanNotes(page, fan);

      if (notes.length === 0) {
        console.log(`  📭 @${fan.username} 没有可评论的笔记`);
        skippedCount++;
        continue;
      }

      // 4. 只评论粉丝最新的 1 篇笔记（避免过度）
      const targetNote = notes[0];
      const result = await commentOnNote(page, fan, targetNote);

      if (result.commented) {
        commentedCount++;
        batchCounter++;
        interactedFans.add(fan.username);
        details.push({ fan: fan.username, noteTitle: result.noteTitle || '', comment: result.comment });
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
  } catch (err) {
    console.error('❌ 粉丝互动异常:', err.message);
    errors.push(err.message);
  }

  return { commentedCount, skippedCount, errors, details };
}
