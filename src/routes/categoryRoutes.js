import express from 'express';
import Category from '../models/Category.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Hardcoded data for seeding
const hardcodedCategories = [
  {
    name: 'SNEKERS',
    subCategories: ['ALL SNEAKERS', 'RUNNING', 'BASKETBALL', 'LIFESTYLE', 'HIGH TOPS', 'LOW TOPS'],
    brands: ['NIKE', 'ADIDAS', 'JORDAN', 'PUMA', 'NEW BALANCE', 'CONVERSE', 'VANS', 'REEBOK']
  },
  {
    name: 'APPAREL',
    subCategories: ['ALL CLOTHING', 'T-SHIRTS', 'SHIRTS', 'HOODIES', 'JACKETS', 'PANTS', 'SHORTS'],
    brands: ['NIKE', 'ADIDAS', 'PUMA', 'JORDAN', 'THE NORTH FACE', 'ESSENTIALS', 'UNDER ARMOUR']
  },
  {
    name: 'BOOTS',
    subCategories: ['ALL BOOTS', 'HIKING', 'CASUAL', 'WINTER'],
    brands: ['TIMBERLAND', 'DR. MARTENS', 'UGG', 'COLUMBIA', 'SOREL']
  },
  {
    name: 'MEN',
    subCategories: ['ALL MEN', 'SHOES', 'CLOTHING', 'ACCESSORIES'],
    brands: ['NIKE', 'ADIDAS', 'JORDAN', 'PUMA', 'NEW BALANCE']
  },
  {
    name: 'WOMEN',
    subCategories: ['ALL WOMEN', 'SHOES', 'CLOTHING', 'ACCESSORIES'],
    brands: ['NIKE', 'ADIDAS', 'JORDAN', 'PUMA', 'NEW BALANCE']
  },
  {
    name: 'KIDS',
    subCategories: ['ALL KIDS', 'BOYS', 'GIRLS', 'SHOES', 'CLOTHING'],
    brands: ['NIKE', 'ADIDAS', 'JORDAN', 'PUMA']
  },
  {
    name: 'ACCESSORIES',
    subCategories: ['ALL ACCESSORIES', 'BAGS', 'HATS', 'SOCKS', 'WATCHES', 'WALLETS', 'SUNGLASSES'],
    brands: ['NIKE', 'ADIDAS', 'PUMA', 'JORDAN', 'RESTYLE', 'CASIO']
  }
];

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

// POST seed categories from hardcoded data - admin only (must be before /:id)
router.post('/seed', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const results = [];
    
    for (const catData of hardcodedCategories) {
      let category = await Category.findOne({ name: catData.name });
      
      if (category) {
        category.subCategories = [...new Set([...category.subCategories, ...catData.subCategories])];
        category.brands = [...new Set([...category.brands, ...catData.brands])];
        await category.save();
      } else {
        category = new Category(catData);
        await category.save();
      }
      results.push(category);
    }
    
    res.json({ 
      success: true, 
      message: `Seeded ${results.length} categories with subcategories and brands`,
      categories: results 
    });
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
    const { name, description, image, subCategories, brands, order, parentCategories } = req.body;
    
    // Parse parentCategories if it comes as a stringified JSON array (from FormData)
    let parsedParentCategories = [];
    if (parentCategories) {
      try {
        parsedParentCategories = typeof parentCategories === 'string' 
          ? JSON.parse(parentCategories) 
          : parentCategories;
      } catch (error) {
        console.error('Failed to parse parentCategories:', error);
      }
    }
    
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
      brands: brands || [],
      order: order || 0,
      parentCategories: parsedParentCategories
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
    const { name, description, image, subCategories, brands, isActive, order, parentCategories } = req.body;
    
    // Parse parentCategories if it comes as a stringified JSON array (from FormData)
    let parsedParentCategories = undefined;
    if (parentCategories !== undefined) {
      try {
        parsedParentCategories = typeof parentCategories === 'string' 
          ? JSON.parse(parentCategories) 
          : parentCategories;
      } catch (error) {
        console.error('Failed to parse parentCategories:', error);
      }
    }
    
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    
    if (name) category.name = name.toUpperCase();
    if (description !== undefined) category.description = description;
    if (image !== undefined) category.image = image;
    if (subCategories !== undefined) category.subCategories = subCategories;
    if (brands !== undefined) category.brands = brands;
    if (isActive !== undefined) category.isActive = isActive;
    if (order !== undefined) category.order = order;
    if (parsedParentCategories !== undefined) category.parentCategories = parsedParentCategories;
    
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

// POST add brand to category - admin only
router.post('/:id/brands', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { brand } = req.body;
    
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    
    const normalizedBrand = brand.toUpperCase();
    if (category.brands.includes(normalizedBrand)) {
      return res.status(400).json({ success: false, message: 'Brand already exists in this category' });
    }
    
    category.brands.push(normalizedBrand);
    await category.save();
    res.json({ success: true, category });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE brand from category - admin only
router.delete('/:id/brands/:brand', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    
    category.brands = category.brands.filter(
      b => b !== req.params.brand.toUpperCase()
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
