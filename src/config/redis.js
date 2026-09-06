export const redisConfig = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined
};

// Return ioredis connection options
export const getRedisConnectionOptions = () => {
  if (process.env.REDIS_URL) {
    // If a full REDIS_URL is provided (e.g. redis://user:pass@host:port), return connection details or parse it
    // ioredis accepts URL directly as connection options: new Redis(url)
    // BullMQ allows passing connection parameter as IORedis instance or options object.
    // For standard options object, if we have REDIS_URL, we can pass it or parse it.
    try {
      const parsed = new URL(process.env.REDIS_URL);
      return {
        host: parsed.hostname,
        port: parseInt(parsed.port || '6379'),
        username: parsed.username || undefined,
        password: parsed.password || undefined,
        tls: process.env.REDIS_URL.startsWith('rediss://') ? {} : undefined
      };
    } catch (e) {
      console.warn('⚠️ Failed to parse REDIS_URL, falling back to localhost:', e.message);
    }
  }
  return {
    host: redisConfig.host,
    port: redisConfig.port,
    password: redisConfig.password
  };
};
