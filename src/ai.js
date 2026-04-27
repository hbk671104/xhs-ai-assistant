/**
 * 豆包 AI 评论生成模块
 * 用于在粉丝发布的笔记下生成自然、真诚的评论
 * 支持多模态：文字 + 图片/视频截图
 */
import config from './config.js';

const SYSTEM_PROMPT = `你是一个小红书博主，正在浏览关注你的粉丝发布的笔记内容。你需要以真实博主的身份，在粉丝的帖子下留下评论，表达你对粉丝内容的关注和认可。

评论要求：
1. 语气亲切、真诚、自然，像朋友之间的互动
2. 适当使用表情符号 emoji（不要堆砌，1-3 个即可）
3. 评论要与笔记内容相关，体现你真的看了内容（包括图片和视频内容）
4. 简短精炼，1-2 句话，不要长篇大论
5. 可以夸赞、共鸣、提问或分享感受
6. 不要太套路化，每条评论风格略有不同
7. 如果笔记内容是广告、低质内容、或你无法理解的，请返回空字符串 ""
8. 绝不暴露自己是 AI
9. 如果提供了图片，请仔细观察图片内容，评论应体现你看到了图片中的具体细节

注意：只返回评论内容本身，不要加引号或其他格式。对于需要跳过的笔记，只返回空字符串。`;

/**
 * 调用 DeepSeek 生成针对粉丝笔记的评论（支持多模态）
 * @param {string} noteContent - 粉丝笔记的正文内容
 * @param {string} fanUsername - 粉丝用户名（上下文）
 * @param {Array<string>} imageBase64List - 图片 base64 数据列表（可选）
 * @returns {string} 评论内容，空字符串表示跳过
 */
export async function generateComment(noteContent, fanUsername = '', imageBase64List = []) {
  const hasImages = imageBase64List.length > 0;
  const textPart = `粉丝 @${fanUsername} 发布的笔记内容：\n「${noteContent.slice(0, 500)}」${hasImages ? `\n\n（附带 ${imageBase64List.length} 张图片，请结合图片内容评论）` : ''}\n\n请以博主身份生成一条自然的评论：`;

  // 构建消息内容：多模态时使用 content 数组格式
  let userContent;
  if (hasImages) {
    userContent = [
      { type: 'text', text: textPart },
      ...imageBase64List.map((b64) => ({
        type: 'image_url',
        image_url: { url: b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}` },
      })),
    ];
    console.log(`🖼️ 发送 ${imageBase64List.length} 张图片给 AI 分析`);
  } else {
    userContent = textPart;
  }

  try {
    const resp = await fetch(`${config.doubao.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.doubao.apiKey}`,
      },
      body: JSON.stringify({
        model: config.doubao.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        max_tokens: 256,
        temperature: 0.8,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`豆包 API ${resp.status}: ${errText}`);
    }

    const data = await resp.json();
    const reply = (data.choices?.[0]?.message?.content || '').trim();

    // 去除可能的引号包裹
    const cleaned = reply.replace(/^["'""'']|["'""'']$/g, '');

    console.log(`🤖 AI 评论: "${cleaned}" (笔记: "${noteContent.slice(0, 30)}...")`);
    return cleaned;
  } catch (err) {
    console.error('❌ 豆包调用失败:', err.message);
    throw err;
  }
}
