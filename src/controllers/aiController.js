import { GoogleGenerativeAI } from '@google/generative-ai';
import Product from '../models/Product.js';

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Define the tool that Gemini can use to search MongoDB
const searchDatabaseTool = {
  name: "searchDatabase",
  description: "Search the Seekon Apparel database for products. IMPORTANT: You must extract and provide ONLY ONE single keyword. If the user asks for 'Nike shoes', your query MUST be exactly 'Nike'. If they ask for 'black hoodies', query 'hoodie'. Never use multiple words.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "A STRICTLY SINGLE-WORD keyword (e.g., 'Nike', 'sneakers', 'hoodie'). Never send two words."
      }
    },
    required: ["query"]
  }
};

// Configure the model with its persona and tools
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  systemInstruction: "You are Seekon AI, the intelligent and stylish shopping assistant for Seekon Apparel in Kenya. You are helpful, concise, and friendly. Prices are always in Kenyan Shillings (KSh). Never invent products; always use the searchDatabase tool to check real inventory. If a requested item is out of stock or not found, politely suggest browsing our other collections.",
  tools: [{ functionDeclarations: [searchDatabaseTool] }]
});

export const processAIChat = async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, message: "Message is required." });
    }

    // Start a chat session
    const chat = model.startChat();

    // Send the user's message to Gemini
    const result = await chat.sendMessage(message);
    const response = result.response;

    // Check if Gemini decided it needs to search the database
    const functionCalls = response.functionCalls();
    if (functionCalls && functionCalls.length > 0) {
      const call = functionCalls[0];

      if (call.name === "searchDatabase") {
        const searchQuery = call.args.query;
        console.log(`🤖 AI is searching DB for: ${searchQuery}`);
    console.log(`[DEPLOY TRIGGER] Redeployment initiated at ${new Date().toISOString()}`);

        // Perform the actual MongoDB Search
        const products = await Product.find({
          $or: [
            { name: { $regex: searchQuery, $options: 'i' } },
            { brand: { $regex: searchQuery, $options: 'i' } },
            { category: { $regex: searchQuery, $options: 'i' } }
          ]
        }).limit(4); // Limit to top 4 so we don't overwhelm the chat UI

        // Format the data so Gemini can easily read it
        const formattedInventory = products.map(p => ({
          id: p._id,
          name: p.name,
          price: `KSh ${p.price}`,
          stockStatus: p.stock > 0 ? 'In Stock' : 'Out of Stock'
        }));

        // Send the database results BACK to Gemini so it can generate a natural response
        const finalResult = await chat.sendMessage([{
          functionResponse: {
            name: "searchDatabase",
            response: { products: formattedInventory }
          }
        }]);

        return res.status(200).json({
          success: true,
          reply: finalResult.response.text(),
          suggestedProducts: products // We pass the raw products to the frontend so we can render actual image cards in the UI!
        });
      }
    }

    // If Gemini didn't need to search the DB (e.g., standard greeting or shipping question)
    return res.status(200).json({
      success: true,
      reply: response.text(),
      suggestedProducts: []
    });

  } catch (error) {
    console.error('AI Chat Error:', error);
    res.status(500).json({ success: false, reply: "I'm having a little trouble connecting to my brain right now. Please try again in a moment!" });
  }
};
