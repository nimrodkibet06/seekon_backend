# Wishlist API Documentation

## Overview
The Wishlist API manages user wishlists with persistent storage in MongoDB.

---

## Base URL
```
http://localhost:3000/api/wishlist
```

---

## Authentication
All endpoints require JWT authentication via the `Authorization` header:
```
Authorization: Bearer <token>
```

---

## Endpoints

### 1. Get User's Wishlist

**Endpoint:** `GET /:userId`

**Description:** Retrieve all items in a user's wishlist.

**Example Request:**
```bash
curl -X GET http://localhost:3000/api/wishlist/65a1b2c3d4e5f6789abc123 \
  -H "Authorization: Bearer <token>"
```

**Example Response:**
```json
{
  "success": true,
  "wishlist": {
    "_id": "65a1b2c3d4e5f6789abc456",
    "userId": "65a1b2c3d4e5f6789abc123",
    "items": [
      {
        "productId": "65a1b2c3d4e5f6789abc789",
        "name": "Nike Air Max 270",
        "brand": "Nike",
        "price": 12999,
        "image": "https://example.com/image.jpg",
        "addedAt": "2025-01-15T10:30:00.000Z"
      }
    ],
    "createdAt": "2025-01-15T10:00:00.000Z",
    "updatedAt": "2025-01-15T10:30:00.000Z"
  }
}
```

---

### 2. Add Item to Wishlist

**Endpoint:** `POST /:userId/add`

**Description:** Add a product to the user's wishlist. Prevents duplicates.

**Request Body:**
```json
{
  "productId": "65a1b2c3d4e5f6789abc789",
  "name": "Nike Air Max 270",
  "brand": "Nike",
  "price": 12999,
  "image": "https://example.com/image.jpg"
}
```

**Example Request:**
```bash
curl -X POST http://localhost:3000/api/wishlist/65a1b2c3d4e5f6789abc123/add \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "productId": "65a1b2c3d4e5f6789abc789",
    "name": "Nike Air Max 270",
    "brand": "Nike",
    "price": 12999,
    "image": "https://example.com/image.jpg"
  }'
```

**Success Response (Item Added):**
```json
{
  "success": true,
  "added": true,
  "message": "Item added to wishlist",
  "wishlist": {
    "_id": "65a1b2c3d4e5f6789abc456",
    "userId": "65a1b2c3d4e5f6789abc123",
    "items": [
      {
        "productId": "65a1b2c3d4e5f6789abc789",
        "name": "Nike Air Max 270",
        "brand": "Nike",
        "price": 12999,
        "image": "https://example.com/image.jpg",
        "addedAt": "2025-01-15T10:30:00.000Z"
      }
    ]
  }
}
```

**Success Response (Item Already Exists):**
```json
{
  "success": true,
  "added": false,
  "message": "Item already in wishlist",
  "wishlist": {
    "_id": "65a1b2c3d4e5f6789abc456",
    "userId": "65a1b2c3d4e5f6789abc123",
    "items": [...]
  }
}
```

---

### 3. Remove Item from Wishlist

**Endpoint:** `DELETE /:userId/remove`

**Description:** Remove a specific product from the user's wishlist.

**Request Body:**
```json
{
  "productId": "65a1b2c3d4e5f6789abc789"
}
```

**Example Request:**
```bash
curl -X DELETE http://localhost:3000/api/wishlist/65a1b2c3d4e5f6789abc123/remove \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "productId": "65a1b2c3d4e5f6789abc789"
  }'
```

**Example Response:**
```json
{
  "success": true,
  "message": "Item removed from wishlist",
  "wishlist": {
    "_id": "65a1b2c3d4e5f6789abc456",
    "userId": "65a1b2c3d4e5f6789abc123",
    "items": []
  }
}
```

---

### 4. Clear Wishlist

**Endpoint:** `DELETE /:userId/clear`

**Description:** Remove all items from the user's wishlist.

**Example Request:**
```bash
curl -X DELETE http://localhost:3000/api/wishlist/65a1b2c3d4e5f6789abc123/clear \
  -H "Authorization: Bearer <token>"
```

**Example Response:**
```json
{
  "success": true,
  "message": "Wishlist cleared",
  "wishlist": {
    "_id": "65a1b2c3d4e5f6789abc456",
    "userId": "65a1b2c3d4e5f6789abc123",
    "items": []
  }
}
```

---

## Error Responses

### 401 Unauthorized
```json
{
  "success": false,
  "message": "Unauthorized. Please log in."
}
```

### 404 Not Found
```json
{
  "success": false,
  "message": "Wishlist not found"
}
```

### 500 Internal Server Error
```json
{
  "success": false,
  "message": "Error message here"
}
```

---

## Implementation Notes

1. **Automatic Wishlist Creation**: A wishlist is automatically created when the first item is added.
2. **Duplicate Prevention**: The API prevents adding the same product twice.
3. **User Isolation**: Each user can only access their own wishlist.
4. **Persistent Storage**: All wishlist data is stored in MongoDB and persists across sessions.
5. **Timestamp Tracking**: Each item includes an `addedAt` timestamp.

---

## Frontend Integration

The frontend uses Redux slices with async thunks:

- `fetchWishlist(userId)` - Load user's wishlist from API
- `addToWishlistAPI({ userId, product })` - Add product to wishlist
- `removeFromWishlistAPI({ userId, productId })` - Remove product from wishlist
- `clearWishlistAPI(userId)` - Clear entire wishlist

The Redux store also includes local actions for offline functionality:
- `addToWishlistLocal({ product })` - Add to local Redux state
- `removeFromWishlistLocal({ productId })` - Remove from local state
- `clearWishlistLocal()` - Clear local state

---

## Testing

Use the provided API endpoints with Postman, cURL, or any HTTP client to test the wishlist functionality.




