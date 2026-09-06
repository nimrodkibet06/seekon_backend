import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

console.log('Connecting to:', process.env.MONGO_URI);
try {
  const conn = await mongoose.connect(process.env.MONGO_URI, {
    family: 4,
    serverSelectionTimeoutMS: 5000,
  });
  console.log('Success!', conn.connection.host);
  process.exit(0);
} catch (e) {
  console.error('Failed!', e.message);
  process.exit(1);
}
