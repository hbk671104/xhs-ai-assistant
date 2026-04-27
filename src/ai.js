/**
 * DeepSeek AI 回复生成模块
 */
import config from './config.js';

const SYSTEM_PROMPT = `你是一个小红书博主的 AI 助手，负责回复粉丝的评论。

回复要求：
1. 语气亲切、活泼、接地气
2. 多使用表情符号 emoji（如 😊🥰✨💕🎉👏❤️）
3. 回复简短精炼，1-3 句话即可
4. 像真人一样自然聊天，不要太正式
5. 如果评论是赞美/支持类，热情感谢
6. 如果评论是提问，简短回答并表示感谢关注
7. 如果评论包含广告、辱骂、无意义内容，或你无法理解，请返回空字符串 ""
8. 不要暴露自己是 AI

注意：只返回回复内容本身，不要加引号或其他格式。对于需要跳过的评论，只返回空字符串。`;

/**
 * 调用 DeepSeek 生成回复
 * @param {string} commentText - 原始评论内容
 * @param {string} noteTitle - 笔记标题（上下文）
 * @returns {string} 回复内容，空字符串表示跳过
 */
export async function generateReply(commentText, noteTitle = '') {
  const userMessage = noteTitle
    ? `笔记标题：「${noteTitle}」\n粉丝评论：「${commentText}」\n请生成合适的回复：`
    : `粉丝评论：「${commentText}」\n请生成合适的回复：`;

  try {
    const resp = await fetch(`${config.deepseek.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.deepseek.apiKey}`,
      },
      body: JSON.stringify({
        model: config.deepseek.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 256,
        temperature: 0.8,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`DeepSeek API ${resp.status}: ${errText}`);
    }

    const data = await resp.json();
    const reply = (data.choices?.[0]?.message?.content || '').trim();

    // 去除可能的引号包裹
    const cleaned = reply.replace(/^["'""'']|["'""'']$/g, '');

    console.log(`🤖 AI 回复: "${cleaned}" (原评论: "${commentText.slice(0, 30)}...")`);
    return cleaned;
  } catch (err) {
    console.error('❌ DeepSeek 调用失败:', err.message);
    throw err;
  }
}
