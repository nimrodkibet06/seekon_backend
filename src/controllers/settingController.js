import Setting from '../models/Setting.js';

// Get exchange rate (Public)
export const getExchangeRate = async (req, res) => {
  try {
    const settings = await Setting.findOne({ key: 'exchangeRate' });
    if (!settings) {
      // Return default rate if not found
      return res.status(200).json({ success: true, rate: 130 });
    }
    res.status(200).json({ success: true, rate: settings.value.rate });
  } catch (error) {
    console.error('❌ GET_EXCHANGE_RATE Error:', error.message);
    res.status(500).json({ message: 'Error fetching exchange rate', error: error.message });
  }
};

// Update exchange rate (Admin)
export const updateExchangeRate = async (req, res) => {
  try {
    const { rate } = req.body;
    
    if (!rate || typeof rate !== 'number' || rate <= 0) {
      return res.status(400).json({ message: 'Valid exchange rate is required' });
    }

    const settings = await Setting.findOneAndUpdate(
      { key: 'exchangeRate' },
      { 
        key: 'exchangeRate',
        value: { rate },
        updatedAt: Date.now()
      },
      { new: true, upsert: true }
    );
    
    res.status(200).json({ success: true, rate: settings.value.rate });
  } catch (error) {
    console.error('❌ UPDATE_EXCHANGE_RATE Error:', error.message);
    res.status(500).json({ message: 'Error updating exchange rate', error: error.message });
  }
};

// Get flash sale settings (Public)
export const getFlashSaleSettings = async (req, res) => {
  try {
    const settings = await Setting.findOne({ key: 'flashSale' });
    console.log('🔍 GET_FLASH_SALE_SETTINGS - Found:', settings ? settings.value : 'default');
    if (!settings) {
      // Default settings if not found
      return res.status(200).json({ isActive: false, endTime: null });
    }
    // Return the value object directly
    res.status(200).json(settings.value);
  } catch (error) {
    console.error('❌ GET_FLASH_SALE_SETTINGS Error:', error.message);
    res.status(500).json({ message: 'Error fetching settings', error: error.message });
  }
};

// Update flash sale settings (Admin)
console.log('UPDATE_FLASH_SALE_SETTINGS', 'Endpoint Hit');
export const updateFlashSaleSettings = async (req, res) => {
  try {
    console.log('UPDATE_FLASH_SALE_SETTINGS', req.body);
    const { isActive, endTime } = req.body;
    
    const settings = await Setting.findOneAndUpdate(
      { key: 'flashSale' },
      { 
        key: 'flashSale',
        value: { isActive, endTime },
        updatedAt: Date.now()
      },
      { new: true, upsert: true }
    );
    
    console.log('UPDATED_FLASH_SALE_SETTINGS', settings);
    res.status(200).json(settings.value);
  } catch (error) {
    res.status(500).json({ message: 'Error updating settings', error: error.message });
  }
};

// GET Home Page Settings
export const getHomeSettings = async (req, res) => {
  try {
    const settings = await Setting.findOne({ key: 'homePage' });
    // Default values for a new setup
    const defaults = {
      heroVideoUrl: "https://res.cloudinary.com/demo/video/upload/v1689264426/running_shoes_promo.mp4",
      heroHeading: "STEP INTO THE FUTURE",
      heroSubtitle: "Discover the latest drops from Nike, Adidas, Jordan, and more.",
      heroOverlayOpacity: 50, // 0-100%
      heroHeight: 85, // 50-100vh
      heroHeadingSize: "large", // small, medium, large, xlarge
      showHeroBadge: true // boolean
    };
    
    // Merge saved settings with defaults to ensure all fields exist
    res.status(200).json(settings ? { ...defaults, ...settings.value } : defaults);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching home settings' });
  }
};

// UPDATE Home Page Settings
export const updateHomeSettings = async (req, res) => {
  // Destructure all possible fields
  const { heroVideoUrl, heroHeading, heroSubtitle, heroOverlayOpacity, heroHeight, heroHeadingSize, showHeroBadge } = req.body;

  try {
    const settings = await Setting.findOneAndUpdate(
      { key: 'homePage' },
      { key: 'homePage', value: { heroVideoUrl, heroHeading, heroSubtitle, heroOverlayOpacity, heroHeight, heroHeadingSize, showHeroBadge } },
      { new: true, upsert: true }
    );
    res.status(200).json(settings.value);
  } catch (error) {
    res.status(500).json({ message: 'Server error updating home settings' });
  }
};
