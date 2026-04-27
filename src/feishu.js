/**
 * 飞书 Webhook 通知模块
 */
import config from './config.js';

const WEBHOOK_URL = config.feishu.webhookUrl;

/**
 * 发送飞书文本消息
 */
export async function sendText(text) {
  try {
    const resp = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'text',
        content: { text },
      }),
    });
    if (!resp.ok) {
      console.error(`飞书通知发送失败: ${resp.status}`);
    }
  } catch (err) {
    console.error('飞书通知异常:', err.message);
  }
}

/**
 * 发送告警
 */
export async function sendAlert(message) {
  await sendText(`🚨 小红书 AI 助手告警\n${message}`);
}

/**
 * 发送每日汇总报告
 * @param {object} params
 * @param {number} params.commentedCount - 今日评论总数
 * @param {number} params.skippedCount - 今日跳过总数
 * @param {string[]} params.errors - 今日所有错误
 * @param {Array<{fan, noteTitle, comment}>} params.details - 今日所有互动明细
 */
export async function sendDailyReport({ commentedCount, skippedCount, errors, details = [] }) {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const lines = [
    `📋 ═══ 今日互动汇总 ═══`,
    `📅 日期: ${now}`,
    ``,
    `✅ 今日评论: ${commentedCount} 条`,
    `⏭️ 今日跳过: ${skippedCount} 条`,
    errors.length > 0 ? `❌ 今日错误: ${errors.length} 个` : '✨ 今日无错误',
  ];

  // 完整互动明细
  if (details.length > 0) {
    lines.push('');
    lines.push('📝 今日互动明细：');
    for (let i = 0; i < details.length; i++) {
      const d = details[i];
      const noteShort = d.noteTitle ? d.noteTitle.slice(0, 25) : '(无标题)';
      const commentShort = d.comment.slice(0, 50);
      lines.push(`  ${i + 1}. @${d.fan} —「${noteShort}」`);
      lines.push(`     💬 ${commentShort}`);
    }
  } else {
    lines.push('');
    lines.push('📭 今日无互动记录');
  }

  if (errors.length > 0) {
    lines.push('');
    lines.push('⚠️ 错误汇总:');
    for (const e of errors.slice(-5)) {
      lines.push(`  • ${e}`);
    }
  }

  lines.push('');
  lines.push('🌙 已进入休眠，明天见！');

  await sendText(lines.join('\n'));
}
