import express from 'express';
import Category from '../models/Category.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';

const router = express.Router();

// GET all categories - public
router.get('/', async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true }).sort({ order: 1, name: 1 });
    res.json({ success: true, categories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET all categories (including inactive) - admin only
router.get('/all', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const categories = await Category.find().sort({ order: 1, name: 1 });
    res.json({ success: true, categories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET single category by ID - public
router.get('/:id', async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    res.json({ success: true, category });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST create new category - admin only
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, description, image, subCategories, order } = req.body;
    
    // Check if category already exists
    const existingCategory = await Category.findOne({ name: name.toUpperCase() });
    if (existingCategory) {
      return res.status(400).json({ success: false, message: 'Category already exists' });
    }
    
    const category = new Category({
      name,
      description,
      image,
      subCategories: subCategories || [],
      order: order || 0
    });
    
    await category.save();
    res.status(201).json({ success: true, category });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT update category - admin only
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, description, image, subCategories, isActive, order } = req.body;
    
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    
    if (name) category.name = name.toUpperCase();
    if (description !== undefined) category.description = description;
    if (image !== undefined) category.image = image;
    if (subCategories !== undefined) category.subCategories = subCategories;
    if (isActive !== undefined) category.isActive = isActive;
    if (order !== undefined) category.order = order;
    
    await category.save();
    res.json({ success: true, category });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST add sub-category to category - admin only
router.post('/:id/subcategories', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { subCategory } = req.body;
    
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    
    const normalizedSubCat = subCategory.toUpperCase();
    if (category.subCategories.includes(normalizedSubCat)) {
      return res.status(400).json({ success: false, message: 'Sub-category already exists' });
    }
    
    category.subCategories.push(normalizedSubCat);
    await category.save();
    res.json({ success: true, category });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE sub-category from category - admin only
router.delete('/:id/subcategories/:subCategory', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    
    category.subCategories = category.subCategories.filter(
      sub => sub !== req.params.subCategory.toUpperCase()
    );
    await category.save();
    res.json({ success: true, category });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE category - admin only
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const category = await Category.findByIdAndDelete(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    res.json({ success: true, message: 'Category deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
