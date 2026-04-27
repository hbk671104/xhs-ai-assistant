/**
 * 熔断器模块 — 异常检测与自动停止
 */
import { sendAlert } from './feishu.js';

class CircuitBreaker {
  constructor() {
    // 连续失败计数
    this.consecutiveFailures = 0;
    this.maxConsecutiveFailures = 3;

    // 频繁操作检测
    this.rateLimitDetected = false;

    // 重定向检测
    this.redirectCount = 0;
    this.maxRedirects = 5;

    // 已触发熔断
    this.tripped = false;
  }

  /**
   * 记录一次成功
   */
  recordSuccess() {
    this.consecutiveFailures = 0;
    this.redirectCount = 0;
  }

  /**
   * 记录一次元素定位失败
   */
  recordFailure() {
    this.consecutiveFailures++;
    console.warn(`⚠️ 连续失败: ${this.consecutiveFailures}/${this.maxConsecutiveFailures}`);
  }

  /**
   * 记录一次重定向
   */
  recordRedirect() {
    this.redirectCount++;
    console.warn(`⚠️ 重定向计数: ${this.redirectCount}/${this.maxRedirects}`);
  }

  /**
   * 检测"操作频繁"提示
   */
  async checkRateLimit(page) {
    try {
      const rateLimitHints = [
        '操作频繁',
        '操作太快',
        '请稍后再试',
        '频繁操作',
        '访问受限',
        '异常行为',
      ];

      const bodyText = await page.textContent('body').catch(() => '');
      for (const hint of rateLimitHints) {
        if (bodyText.includes(hint)) {
          this.rateLimitDetected = true;
          console.error(`🚨 检测到频率限制提示: "${hint}"`);
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * 判断是否应该熔断
   */
  async shouldTrip(page) {
    if (this.tripped) return true;

    // 检测频率限制
    if (page) {
      await this.checkRateLimit(page);
    }

    if (this.rateLimitDetected) {
      this.tripped = true;
      await sendAlert('检测到"操作频繁"提示！已触发熔断，脚本即将安全退出。');
      return true;
    }

    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      this.tripped = true;
      await sendAlert(
        `连续 ${this.consecutiveFailures} 次元素定位失败！可能页面结构变化，已触发熔断。`
      );
      return true;
    }

    if (this.redirectCount >= this.maxRedirects) {
      this.tripped = true;
      await sendAlert(
        `检测到频繁重定向 (${this.redirectCount} 次)！可能被风控，已触发熔断。`
      );
      return true;
    }

    return false;
  }

  /**
   * 重置状态
   */
  reset() {
    this.consecutiveFailures = 0;
    this.rateLimitDetected = false;
    this.redirectCount = 0;
    this.tripped = false;
  }
}

// 单例导出
export const circuitBreaker = new CircuitBreaker();
