import Groq from 'groq-sdk';
import Product from '../models/Product.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// 1. Define the Tool using Groq/OpenAI syntax
const tools = [
  {
    type: "function",
    function: {
      name: "searchDatabase",
      description: "Search the Seekon Apparel database for products. IMPORTANT: You must extract and provide ONLY ONE single keyword.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "A STRICTLY SINGLE-WORD keyword (e.g., 'Nike', 'sneakers')." },
          skip: { type: "integer", description: "The number of products to skip. Default is 0. If the user asks for 'more' or 'other options', set this to 5. If they ask again, set to 10." }
        },
        required: ["query"]
      }
    }
  }
];

const systemPrompt = `You are Seekon AI, the intelligent shopping assistant for Seekon Apparel in Kenya.
CORE RULES:

PRICES: Always use KSh.

INVENTORY: Never invent products. You have access to a database search tool. Use it automatically when needed, but DO NOT write raw XML, <function> tags, or JSON code in your text responses. Let the system handle the tool execution.

LINKS: Format products as Markdown links: [Product Name](/product/{id}).

OUT OF STOCK: If the database search returns "no_results", politely apologize and immediately offer to show them items from the "availableCategories" provided in the data. Make it sound natural.

LIST FORMATTING: Use numbered lists. Max 5 items. Always end with a follow-up question.

SEEKON STORE POLICIES:

Delivery: We deliver to all major towns across Kenya.

Payments: We accept M-Pesa.

Contact: You can email us at support@seekon.app or call our customer care at 0700-000-000.

Returns & Exchanges: We accept returns within 14 days of delivery.

Order Tracking: Track your order via the "Track Order" tab in your account.

Size Guide: Refer to the specific sizing chart on each product page.`;

export const processAIChat = async (req, res) => {
try {
const { message, history = [] } = req.body;
if (!message) return res.status(400).json({ success: false, message: "Message required." });

// Map frontend history to Groq syntax
const formattedHistory = history.map(msg => ({
  role: msg.sender === 'ai' ? 'assistant' : 'user',
  content: msg.text || ""
}));
const messages = [
  { role: "system", content: systemPrompt },
  ...formattedHistory,
  { role: "user", content: message }
];
// Call Groq
const response = await groq.chat.completions.create({
  model: "llama-3.3-70b-versatile",
  messages: messages,
  tools: tools,
  tool_choice: "auto",
});
const responseMessage = response.choices[0].message;
// Handle Tool Call (Database Search)
if (responseMessage.tool_calls) {
  const toolCall = responseMessage.tool_calls[0];
  const args = JSON.parse(toolCall.function.arguments);
  
  const skipAmount = args.skip || 0;
  console.log(`🤖 Groq AI is searching DB for: ${args.query} | Skipping: ${skipAmount}`);
  const products = await Product.find({
    $or: [
      { name: { $regex: args.query, $options: 'i' } },
      { brand: { $regex: args.query, $options: 'i' } },
      { category: { $regex: args.query, $options: 'i' } }
    ]
  }).skip(skipAmount).limit(5);
  const formattedInventory = products.map(p => ({
    id: p._id, name: p.name, price: `KSh ${p.price}`, stock: p.stock > 0 ? 'In Stock' : 'Out of Stock'
  }));
  // Send DB results back to Groq
  messages.push(responseMessage); // append AI's tool request
  messages.push({
    role: "tool",
    tool_call_id: toolCall.id,
    content: JSON.stringify(formattedInventory)
  });
  const finalResponse = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: messages
  });
  return res.status(200).json({ success: true, reply: finalResponse.choices[0].message.content, suggestedProducts: products });
}
// Normal Response
return res.status(200).json({ success: true, reply: responseMessage.content, suggestedProducts: [] });
} catch (error) {
console.error('Groq AI Error:', error);
res.status(500).json({ success: false, reply: "I'm having trouble connecting right now." });
}
};
