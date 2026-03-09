import express from 'express';
import { processAIChat } from '../controllers/aiController.js';

const router = express.Router();

// POST /api/ai/chat
router.post('/chat', processAIChat);

export default router;
