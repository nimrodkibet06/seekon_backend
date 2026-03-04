# Cart API Documentation

## Endpoints

Base URL: `/api/cart`

All endpoints require authentication (Bearer token in Authorization header).

### 1. Get User's Cart
**GET** `/api/cart/:userId`

Get all items in the user's cart.

**Response:**
```json
{
  "success": true,
  "cart": {
    "userId": "user_id",
    "items": [
      {
        "productId": "product_id",
        "name": "Product Name",
        "brand": "Brand Name",
        "price": 29.99,
        "image": "image_url",
        "size": "M",
        "color": "Black",
        "quantity": 2
      }
    ],
    "totalItems": 2,
    "totalPrice": 59.98
  }
}
```

---

### 2. Add Item to Cart
**POST** `/api/cart/:userId/add`

Add a new item to cart or increase quantity if item already exists.

**Request Body:**
```json
{
  "productId": "product_id",
  "name": "Product Name",
  "brand": "Brand Name",
  "price": 29.99,
  "image": "image_url",
  "size": "M",
  "color": "Black",
  "quantity": 1
}
```

**Response:**
```json
{
  "success": true,
  "message": "Item added to cart" or "Quantity updated",
  "cart": { ... }
}
```

---

### 3. Update Item Quantity
**PATCH** `/api/cart/:userId/update`

Update the quantity of an existing cart item.

**Request Body:**
```json
{
  "productId": "product_id",
  "size": "M",
  "color": "Black",
  "quantity": 3
}
```

**Response:**
```json
{
  "success": true,
  "cart": { ... }
}
```

---

### 4. Remove Item from Cart
**DELETE** `/api/cart/:userId/remove`

Remove a specific item from the cart.

**Request Body:**
```json
{
  "productId": "product_id",
  "size": "M",
  "color": "Black"
}
```

**Response:**
```json
{
  "success": true,
  "cart": { ... }
}
```

---

### 5. Clear Cart
**DELETE** `/api/cart/:userId/clear`

Remove all items from the cart.

**Response:**
```json
{
  "success": true,
  "cart": {
    "userId": "user_id",
    "items": [],
    "totalItems": 0,
    "totalPrice": 0
  }
}
```

---

## Features

✅ **Automatic Quantity Increase**: Adding the same product (same ID, size, color) increases quantity instead of adding duplicates

✅ **Automatic Total Calculation**: Cart totals are calculated automatically on every operation

✅ **Flexible Size Handling**: Supports both items with sizes and items without sizes (size: null)

✅ **Color Variants**: Different colors are treated as different items

✅ **MongoDB Integration**: All cart data is stored persistently in MongoDB

✅ **User Isolation**: Each user has their own cart identified by userId

---

## Frontend Integration

To use these endpoints in the frontend, you'll need to:

1. Replace Redux cart actions with API calls
2. Include the JWT token in the Authorization header
3. Use the authenticated user's ID in the userId parameter

Example fetch call:
```javascript
const response = await fetch(`http://localhost:3000/api/cart/${userId}/add`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    productId: 'product_id',
    name: 'Product Name',
    brand: 'Brand Name',
    price: 29.99,
    image: 'image_url',
    size: 'M',
    color: 'Black',
    quantity: 1
  })
});
```




