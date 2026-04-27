/**
 * 调度器模块 — 控制运行时间与单日限制
 */
import config from './config.js';

class Scheduler {
  constructor() {
    this.dailyReplyCount = 0;
    this.dailyLimit = this.calcDailyLimit();
    this.lastResetDate = this.getTodayString();
  }

  /**
   * 计算今日回复上限（随机化）
   */
  calcDailyLimit() {
    const { dailyReplyMin, dailyReplyMax } = config.limits;
    return Math.floor(Math.random() * (dailyReplyMax - dailyReplyMin + 1)) + dailyReplyMin;
  }

  /**
   * 获取今天日期字符串
   */
  getTodayString() {
    return new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  }

  /**
   * 检查并重置每日计数
   */
  checkDayReset() {
    const today = this.getTodayString();
    if (today !== this.lastResetDate) {
      console.log('🔄 新的一天，重置每日计数');
      this.dailyReplyCount = 0;
      this.dailyLimit = this.calcDailyLimit();
      this.lastResetDate = today;
    }
  }

  /**
   * 是否在活跃时段
   */
  isActiveHour() {
    const now = new Date();
    const hour = parseInt(
      now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false })
    );
    return hour >= config.limits.activeHourStart && hour < config.limits.activeHourEnd;
  }

  /**
   * 是否已达到每日上限
   */
  isLimitReached() {
    this.checkDayReset();
    return this.dailyReplyCount >= this.dailyLimit;
  }

  /**
   * 记录一次回复
   */
  recordReply() {
    this.dailyReplyCount++;
    console.log(`📊 今日回复: ${this.dailyReplyCount}/${this.dailyLimit}`);
  }

  /**
   * 获取到下一个活跃时段的等待时间（ms）
   */
  getMsUntilActiveHour() {
    const now = new Date();
    const shanghaiNow = new Date(
      now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })
    );
    const hour = shanghaiNow.getHours();

    if (hour >= config.limits.activeHourEnd) {
      // 过了结束时间，等到明天开始时间
      const tomorrow = new Date(shanghaiNow);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(config.limits.activeHourStart, 0, 0, 0);
      return tomorrow.getTime() - shanghaiNow.getTime();
    }

    if (hour < config.limits.activeHourStart) {
      // 还没到开始时间
      const start = new Date(shanghaiNow);
      start.setHours(config.limits.activeHourStart, 0, 0, 0);
      return start.getTime() - shanghaiNow.getTime();
    }

    return 0; // 当前在活跃时段
  }

  /**
   * 等待到活跃时段
   */
  async waitForActiveHour() {
    const waitMs = this.getMsUntilActiveHour();
    if (waitMs > 0) {
      const waitMinutes = Math.ceil(waitMs / 60000);
      console.log(`🌙 当前为深夜时段，等待 ${waitMinutes} 分钟后进入活跃时段...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      dailyReplyCount: this.dailyReplyCount,
      dailyLimit: this.dailyLimit,
      isActive: this.isActiveHour(),
      limitReached: this.isLimitReached(),
    };
  }
}

export const scheduler = new Scheduler();
