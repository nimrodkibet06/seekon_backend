import { getGroqClient } from '../utils/groqProvider.js';
import Setting from '../models/Setting.js';

export const processHeroConversationWithAI = async ({
  userMessage,
  currentData,
  conversationHistory = []
}) => {
  try {
    const groq = getGroqClient();

    const systemPrompt = `You are a friendly, conversational Homepage Manager for Seekon's WhatsApp bot.
An admin is chatting with you to update the Homepage Hero section of the website.

The Homepage Hero consists of:
1. Media (Video or Image)
2. Heading (Large text)
3. Subtitle (Smaller text below heading)

CURRENT SESSION STATE:
- Heading: ${currentData.heading || 'Not provided'}
- Subtitle: ${currentData.subtitle || 'Not provided'}
- Has Media Attached in this session: ${currentData.hasMedia ? 'Yes' : 'No'}

YOUR GOAL:
Understand what the admin wants to change. They might want to:
- Change ONLY the text (heading, subtitle, or both) and keep the old media.
- Change ONLY the media (video/photo) and keep the old text.
- Change BOTH.

INSTRUCTIONS:
1. Extract "heading" if the user specifies a new heading/title.
2. Extract "subtitle" if the user specifies a new subtitle/description.
3. Determine "isDone". Set to true IF the user explicitly says they are ready to publish, upload, finish, or proceed. OR, if they clearly provided a quick one-liner command like "change the homepage text to Welcome to Seekon" and it seems like a complete thought, ask them to confirm, or if it's unambiguous, set isDone to true.
4. Generate "naturalReply":
   - Speak naturally, warmly, and concisely.
   - If they provided new text, confirm it.
   - If they uploaded a video but no text, ask if they want to keep the existing text or change it.
   - If they just say "update the homepage", ask them what they want to change (the text, the video, or both) and tell them they can just send it here.
   - If isDone is true, say "Got it! I'm updating the homepage now..."

YOU MUST REPLY WITH A VALID JSON OBJECT ONLY:
{
  "heading": string or null,
  "subtitle": string or null,
  "isDone": boolean,
  "isCancel": boolean,
  "naturalReply": string
}
Do NOT wrap in markdown code fences. Raw JSON string only.`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...conversationHistory.slice(-4),
      { role: "user", content: userMessage }
    ];

    const response = await groq.chat.completions.create({
      model: "openai/gpt-oss-120b",
      messages,
      response_format: { type: "json_object" }
    });

    const resultText = response.choices[0]?.message?.content || "{}";
    return JSON.parse(resultText);
  } catch (err) {
    console.error("❌ [WA-HERO-AI]: Error in processHeroConversationWithAI:", err.message);
    return null;
  }
};
