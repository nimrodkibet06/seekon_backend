import mongoose from 'mongoose';

export const connectDB = async () => {
  // ✅ FAIL-SAFE CHECK: Verify MONGO_URI is defined before connecting
  const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
  
  if (!mongoUri) {
    console.error('❌ Error: Neither MONGO_URI nor DATABASE_URL environment variable is defined!');
    console.error('📝 Please set MONGO_URI or DATABASE_URL in your .env file or environment variables.');
    process.exit(1);
  }

  try {
    const conn = await mongoose.connect(mongoUri, {
      // 👇 THIS IS THE FIX
      // It forces the connection to use IPv4, solving the "querySrv" error
      family: 4,
      serverSelectionTimeoutMS: 5000, // Fail after 5 seconds
      
      // Connection Pooling & Azure Keep-Alive configuration
      maxPoolSize: 50,              // Limit pool size to prevent database overload
      minPoolSize: 5,               // Maintain at least 5 connections ready
      socketTimeoutMS: 45000,       // Close inactive sockets after 45 seconds
      heartbeatFrequencyMS: 30000,  // Ping every 30s to keep Azure Load Balancer connection alive
    });

    console.log('✅ MongoDB Connected Successfully!');
    console.log(`   Host: ${conn.connection.host}`);
    console.log(`   Database: ${conn.connection.name || 'default'}`);
    console.log(`   Connection State: ${conn.connection.readyState === 1 ? 'Connected' : 'Disconnected'}`);
    
    return conn;
  } catch (error) {
    console.error('❌ MongoDB Connection Failed:');
    console.error(`   Error: ${error.message}`);
    
    // Provide helpful troubleshooting tips
    if (error.message.includes('getaddrinfo ENOTFOUND')) {
      console.error('💡 Tip: Check if your MongoDB hostname is correct.');
    } else if (error.message.includes('authentication failed')) {
      console.error('💡 Tip: Check your MongoDB username and password in the connection string.');
    } else if (error.message.includes('querySrv')) {
      console.error('💡 Tip: Add ", family: 4" to your mongoose.connect options.');
    }
    
    process.exit(1);
  }
};