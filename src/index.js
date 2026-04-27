/**
 * 小红书 AI 粉丝互动助手 — 主入口
 */
import config from './config.js';
import { launchBrowser, closeBrowser } from './browser.js';
import { ensureAuthenticated, refreshSession } from './auth.js';
import { processInteractions } from './interactions.js';
import { scheduler } from './scheduler.js';
import { circuitBreaker } from './circuit-breaker.js';
import { sendDailyReport, sendText, sendAlert } from './feishu.js';
import { randomDelay } from './human.js';

/**
 * 每日统计累计器
 */
const dailyStats = {
  commentedCount: 0,
  skippedCount: 0,
  errors: [],
  details: [],
  lastReportDate: '',
  dailyReportSent: false,

  /** 累加一轮的结果 */
  accumulate({ commentedCount, skippedCount, errors, details }) {
    this.commentedCount += commentedCount;
    this.skippedCount += skippedCount;
    this.errors.push(...errors);
    this.details.push(...details);
  },

  /** 检查是否需要重置（新的一天） */
  checkReset() {
    const today = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
    if (today !== this.lastReportDate) {
      this.commentedCount = 0;
      this.skippedCount = 0;
      this.errors = [];
      this.details = [];
      this.dailyReportSent = false;
      this.lastReportDate = today;
    }
  },

  /** 获取当日数据快照 */
  getSnapshot() {
    return {
      commentedCount: this.commentedCount,
      skippedCount: this.skippedCount,
      errors: [...this.errors],
      details: [...this.details],
    };
  },
};

/**
 * 单次运行周期
 */
async function runCycle() {
  let commentedTotal = 0;
  let skippedTotal = 0;
  const allErrors = [];
  let allDetails = [];

  try {
    // 1. 启动浏览器
    await launchBrowser();
    console.log('🚀 浏览器已启动');

    // 2. 鉴权
    const authed = await ensureAuthenticated();
    if (!authed) {
      console.error('❌ 登录失败，本轮退出');
      return;
    }

    // 2.5 主动续期：访问首页刷新 token
    await refreshSession();

    // 3. 执行粉丝互动（去粉丝帖子下评论）
    const result = await processInteractions();
    commentedTotal += result.commentedCount;
    skippedTotal += result.skippedCount;
    allErrors.push(...result.errors);
    allDetails.push(...(result.details || []));
  } catch (err) {
    console.error('❌ 运行周期异常:', err.message);
    allErrors.push(err.message);
  } finally {
    // 4. 关闭浏览器
    await closeBrowser();
  }

  // 5. 累计到每日统计
  dailyStats.checkReset();
  dailyStats.accumulate({
    commentedCount: commentedTotal,
    skippedCount: skippedTotal,
    errors: allErrors,
    details: allDetails,
  });
}

/**
 * 主循环
 */
async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  🌸 小红书 AI 粉丝互动助手 v1.0');
  console.log('═══════════════════════════════════════════');
  console.log(`📋 配置: 每日上限 ${config.limits.dailyReplyMin}-${config.limits.dailyReplyMax} 条`);
  console.log(`⏰ 活跃时段: ${config.limits.activeHourStart}:00 - ${config.limits.activeHourEnd}:00`);
  console.log(`📦 批处理: 每 ${config.limits.batchSize} 条休息 ${config.limits.batchRestMinMinutes}-${config.limits.batchRestMaxMinutes} 分钟`);
  console.log('═══════════════════════════════════════════\n');

  await sendText('🌸 小红书 AI 助手已启动！');

  // 主循环
  while (true) {
    try {
      // 检查是否在活跃时段
      if (!scheduler.isActiveHour()) {
        // 发送今日汇总报告（每天只发一次）
        dailyStats.checkReset();
        if (!dailyStats.dailyReportSent) {
          dailyStats.dailyReportSent = true;
          await sendDailyReport(dailyStats.getSnapshot());
        }

        console.log('🌙 当前为休眠时段');
        await scheduler.waitForActiveHour();
        continue;
      }

      // 检查每日上限
      if (scheduler.isLimitReached()) {
        const status = scheduler.getStatus();
        console.log(`📊 今日已回复 ${status.dailyReplyCount}/${status.dailyLimit}，等待明天`);
        // 等待到明天活跃时段
        const msToTomorrow =
          scheduler.getMsUntilActiveHour() || 60 * 60 * 1000;
        await new Promise((resolve) => setTimeout(resolve, msToTomorrow));
        continue;
      }

      // 检查熔断器
      if (circuitBreaker.tripped) {
        console.error('🚨 熔断器已触发，等待 30 分钟后重试');
        await sendAlert('熔断器已触发，30 分钟后自动恢复。');
        await new Promise((resolve) => setTimeout(resolve, 30 * 60 * 1000));
        circuitBreaker.reset();
        console.log('🔄 熔断器已重置');
        continue;
      }

      // 执行一轮
      console.log(`\n🔄 开始新一轮互动 [${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}]`);
      await runCycle();

      // 轮次间隔：随机等待 20-40 分钟
      const intervalMinutes = Math.random() * 20 + 20;
      console.log(`⏳ 下一轮将在 ${intervalMinutes.toFixed(0)} 分钟后开始...`);
      await new Promise((resolve) =>
        setTimeout(resolve, intervalMinutes * 60 * 1000)
      );
    } catch (err) {
      console.error('❌ 主循环异常:', err.message);
      // 异常后等待 5 分钟再重试
      await randomDelay(5 * 60 * 1000, 5 * 60 * 1000);
    }
  }
}

// 优雅退出
process.on('SIGINT', async () => {
  console.log('\n🛑 收到中断信号，正在安全退出...');
  await closeBrowser();
  await sendText('🛑 小红书 AI 助手已手动停止。');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 收到终止信号，正在安全退出...');
  await closeBrowser();
  await sendText('🛑 小红书 AI 助手已停止（SIGTERM）。');
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  console.error('未处理的 Promise 拒绝:', reason);
});

// 启动
main().catch((err) => {
  console.error('💥 致命错误:', err);
  process.exit(1);
});
