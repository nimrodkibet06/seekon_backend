const products = [
  {
    // 👇 EDIT THIS SECTION WITH YOUR REAL DATA
    name: 'ENTER YOUR REAL PRODUCT NAME HERE', 
    image: '/images/shoe1.jpg', // 👈 Must match the file name you pasted in Step 1
    description: 'Enter the real description of your product here. Make it sound professional!',
    brand: 'Seekon', // or Nike, Adidas, etc.
    category: 'Sneakers', // Must match one of your categories (Sneakers, Apparel, Boots)
    price: 2500, // Your real price in KSh
    countInStock: 10,
    rating: 0, // Start at 0 for new products
    numReviews: 0,
    colors: ['Black', 'Red', 'Gold'], // 👈 Your real colors
  },
  
  // 👇 These are just here to keep the page from looking empty. You can delete them later.
  {
    name: 'Placeholder Sneaker',
    image: '/images/sample.jpg', // It's okay if this image is missing for now
    description: 'This is just a placeholder.',
    brand: 'Nike',
    category: 'Sneakers',
    price: 0,
    countInStock: 0,
    rating: 0,
    numReviews: 0,
    colors: ['White'],
  },
  {
    name: 'Placeholder Hoodie',
    image: '/images/sample.jpg', 
    description: 'This is just a placeholder.',
    brand: 'Seekon',
    category: 'Apparel',
    price: 0,
    countInStock: 0,
    rating: 0,
    numReviews: 0,
    colors: ['Black'],
  }
];

export default products;