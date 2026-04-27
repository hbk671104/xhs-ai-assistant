/**
 * 拟人化操作模块 — 模拟真人行为的延迟与输入
 */

/**
 * 随机延迟 (ms)
 */
export function randomDelay(minMs, maxMs) {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * 模拟真人键盘逐字输入
 * 每个字符间隔 50-200ms 随机
 */
export async function humanTyping(page, selector, text) {
  await page.click(selector);
  await randomDelay(300, 800);

  for (const char of text) {
    await page.keyboard.type(char, {
      delay: Math.floor(Math.random() * 150) + 50,
    });
  }
}

/**
 * 带拟人延迟的点击
 */
export async function humanClick(page, selector, options = {}) {
  const { minDelay = 3000, maxDelay = 10000 } = options;
  await randomDelay(minDelay, maxDelay);
  await page.click(selector);
}

/**
 * 模拟滚动页面
 */
export async function humanScroll(page, distance = 300) {
  await page.mouse.wheel(0, distance);
  await randomDelay(1000, 3000);
}

/**
 * 批处理间歇休息（分钟级）
 */
export async function batchRest(minMinutes, maxMinutes) {
  const minutes =
    Math.random() * (maxMinutes - minMinutes) + minMinutes;
  const ms = Math.floor(minutes * 60 * 1000);
  console.log(`😴 批处理间歇，休息 ${minutes.toFixed(1)} 分钟...`);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 随机 User-Agent 池
 */
const USER_AGENTS = [
  // Desktop Chrome
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  // Desktop Firefox
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0',
  // Desktop Edge
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
  // Mobile
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.52 Mobile Safari/537.36',
];

export function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}
