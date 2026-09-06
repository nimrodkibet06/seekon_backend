import express from 'express';
import Brand from '../models/Brand.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';

const router = express.Router();

// GET all brands - public
router.get('/', async (req, res) => {
  try {
    const brands = await Brand.find({ isActive: true }).sort({ name: 1 });
    res.json({ success: true, brands });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET all brands (including inactive) - admin only
router.get('/all', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const brands = await Brand.find().sort({ name: 1 });
    res.json({ success: true, brands });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST create new brand - admin only
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, description, logo } = req.body;
    
    // Check if brand already exists
    const existingBrand = await Brand.findOne({ name: name.toUpperCase() });
    if (existingBrand) {
      return res.status(400).json({ success: false, message: 'Brand already exists' });
    }
    
    const brand = new Brand({
      name,
      description,
      logo
    });
    
    await brand.save();
    res.status(201).json({ success: true, brand });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT update brand - admin only
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, description, logo, isActive } = req.body;
    
    const brand = await Brand.findById(req.params.id);
    if (!brand) {
      return res.status(404).json({ success: false, message: 'Brand not found' });
    }
    
    if (name) brand.name = name.toUpperCase();
    if (description !== undefined) brand.description = description;
    if (logo !== undefined) brand.logo = logo;
    if (isActive !== undefined) brand.isActive = isActive;
    
    await brand.save();
    res.json({ success: true, brand });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE brand - admin only
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const brand = await Brand.findByIdAndDelete(req.params.id);
    if (!brand) {
      return res.status(404).json({ success: false, message: 'Brand not found' });
    }
    res.json({ success: true, message: 'Brand deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
