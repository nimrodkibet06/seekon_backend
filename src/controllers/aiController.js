import Groq from 'groq-sdk';
import Product from '../models/Product.js';
import Setting from '../models/Setting.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// 1. Define the Tool using Groq/OpenAI syntax
const tools = [
  {
    type: "function",
    function: {
      name: "searchDatabase",
      description: "Search for products. Provide a query or a filter.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keyword search" },
          special_filter: { type: "string", description: "new_arrivals or flash_sale" }
        }
      }
    }
  }
];

const systemPrompt = `You are a specialized store assistant. When using a tool, respond ONLY with the tool call. Do not include any introductory text, XML tags like <function>, or markdown code blocks in your thoughts.

You are Seekon AI, the intelligent shopping assistant for Seekon Apparel in Kenya.
CORE RULES:

PRICES: Always use KSh.

INVENTORY: Never invent products. You have access to a database search tool. Use it automatically when needed, but DO NOT write raw XML, <function> tags, or JSON code in your text responses. Let the system handle the tool execution.

LINKS: Format products as Markdown links: [Product Name](/product/{id}).

OUT OF STOCK: If the database search returns "no_results", politely apologize and immediately offer to show them items from the "availableCategories" provided in the data. Make it sound natural.

LIST FORMATTING: Use numbered lists. Max 5 items. Always end with a follow-up question.

ANTI-HALLUCINATION: NEVER invent or guess product names (e.g., DO NOT output "Product 1", "Product 2"). You must ONLY list the exact product names provided to you by the database tool. If the tool provides 'real_alternatives_to_suggest', use those exact names and prices.

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
  model: "llama-3-70b-8192",
  messages: messages,
  tools: tools,
  tool_choice: "auto",
});
const responseMessage = response.choices[0].message;
// Handle Tool Call (Database Search)
if (responseMessage.tool_calls) {
  const toolCall = responseMessage.tool_calls[0];
  const args = JSON.parse(toolCall.function.arguments);
  
  const skipAmount = parseInt(args.skip) || 0;
  const filterType = args.special_filter || "none";
  let products = [];
  let toolResponseContent = "";
  
  console.log(`🤖 Groq AI DB Search -> Query: ${args.query} | Filter: ${filterType}`);
  
  // Handle the specific queries
  if (filterType === "new_arrivals") {
    // Sort by newest created
    products = await Product.find({}).sort({ createdAt: -1 }).skip(skipAmount).limit(5);
  } else if (filterType === "flash_sale") {
    // Query for flash sale items based on schema
    products = await Product.find({ isFlashSale: true }).skip(skipAmount).limit(5); 
  } else if (args.query) {
    // Standard Text Search
    products = await Product.find({
      $or: [
        { name: { $regex: args.query, $options: 'i' } },
        { brand: { $regex: args.query, $options: 'i' } },
        { category: { $regex: args.query, $options: 'i' } }
      ]
    }).skip(skipAmount).limit(5);
  }
  
  // Handle Results & Fallbacks
  if (products.length === 0) {
    if (filterType === "flash_sale") {
       toolResponseContent = JSON.stringify({ status: "no_flash_sale", message: "There are no flash sales currently active." });
    } else {
       // Fallback: Give REAL products to suggest instead of hallucinating
       const realAlternativeProducts = await Product.find({}).limit(3);
       const formattedAlts = realAlternativeProducts.map(p => ({
         id: p._id, name: p.name, price: `KSh ${p.price}`
       }));
       toolResponseContent = JSON.stringify({
         status: "no_results", 
         message: "Requested items not found.",
         real_alternatives_to_suggest: formattedAlts
       });
    }
  } else {
    const formattedInventory = products.map(p => ({
      id: p._id, name: p.name, price: `KSh ${p.price}`, stock: p.stock > 0 ? 'In Stock' : 'Out of Stock'
    }));
    toolResponseContent = JSON.stringify(formattedInventory);
  }
  
  // Send DB results back to Groq
  messages.push(responseMessage); // append AI's tool request
  messages.push({
    role: "tool",
    tool_call_id: toolCall.id,
    content: toolResponseContent
  });
  const finalResponse = await groq.chat.completions.create({
    model: "llama-3-70b-8192",
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
