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

const systemPrompt = `You are Seekon AI, an expert shopping assistant.
1. SEARCH: Automatically fix typos (e.g., "nkie" -> "nike") before searching.
2. TOOLS: You MUST use the searchDatabase tool for product info.
3. OUTPUT: Provide results in a clean list. Never output <function> or <tool> tags.
4. CURRENCY: Always use KSh. Link format: [Product Name](/product/{id}).`;

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
    // Fuzzy Search - handles typos by creating a flexible pattern
    const rawQuery = args.query || "";
    // This creates a fuzzy pattern: "Nkie" -> "N.*k.*i.*e"
    const fuzzyPattern = rawQuery.split('').join('.*');
    
    // Standard Text Search with fuzzy matching
    products = await Product.find({
      $or: [
        { name: { $regex: fuzzyPattern, $options: 'i' } },
        { brand: { $regex: fuzzyPattern, $options: 'i' } },
        { tags: { $regex: fuzzyPattern, $options: 'i' } }
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
