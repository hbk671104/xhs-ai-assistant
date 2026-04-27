/**
 * 飞书 Webhook 通知模块
 */
import fs from 'node:fs';
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
 * 发送飞书图片消息（Base64）
 */
export async function sendImage(imagePath) {
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    const base64 = imageBuffer.toString('base64');

    const resp = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'interactive',
        card: {
          elements: [
            {
              tag: 'markdown',
              content: '**🔐 小红书登录二维码**\n请尽快扫码登录：',
            },
            {
              tag: 'img',
              img_key: '',
              alt: { tag: 'plain_text', content: '登录二维码' },
              custom_width: '300',
              compact_width: false,
              mode: 'fit_horizontal',
              preview: true,
            },
          ],
          header: {
            title: { content: '小红书 AI 助手 - 登录请求', tag: 'plain_text' },
            template: 'orange',
          },
        },
      }),
    });

    // 飞书自定义机器人不支持直接发图片到卡片，改用富文本 + 文件提示
    if (!resp.ok) {
      // fallback: 发送文本提醒
      await sendText(
        `🔐 小红书需要登录！\n二维码已保存至服务器: ${imagePath}\n请查看服务器截图或手动登录。`
      );
    }
  } catch (err) {
    console.error('飞书图片通知异常:', err.message);
    // fallback
    await sendText(
      `🔐 小红书需要登录！二维码截图路径: ${imagePath}`
    );
  }
}

/**
 * 发送运行报告
 */
export async function sendReport({ repliedCount, skippedCount, errors }) {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const text = [
    `📊 小红书 AI 助手运行报告`,
    `⏰ 时间: ${now}`,
    `✅ 已回复: ${repliedCount} 条`,
    `⏭️ 已跳过: ${skippedCount} 条`,
    errors.length > 0 ? `❌ 错误: ${errors.length} 个` : '✨ 无错误',
    errors.length > 0 ? `最近错误: ${errors.slice(-3).join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  await sendText(text);
}

/**
 * 发送告警
 */
export async function sendAlert(message) {
  await sendText(`🚨 小红书 AI 助手告警\n${message}`);
}
