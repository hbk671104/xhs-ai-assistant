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
 *
 * CloakBrowser 的 humanize 已 patch page.type：移光标（bezier 曲线）到输入框 +
 * 真人打字节奏（含随机停顿、误触回改）。直接委托即可，比手写 keyboard.type 更真。
 */
export async function humanTyping(page, selector, text) {
  await page.type(selector, text);
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
