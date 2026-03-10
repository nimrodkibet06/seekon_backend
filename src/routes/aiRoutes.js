import express from 'express';
import { processAIChat } from '../controllers/aiController.js';

const router = express.Router();

// Health check route to verify router is mounted
router.get('/health', (req, res) => {
  res.status(200).json({ status: "AI Router is awake and mounted!" });
});

// POST /api/ai/chat
router.post('/chat', processAIChat);

export default router;
