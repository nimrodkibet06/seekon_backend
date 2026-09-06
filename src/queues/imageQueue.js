import { Queue } from 'bullmq';
import { getRedisConnectionOptions } from '../config/redis.js';

const connection = getRedisConnectionOptions();

export const imageQueue = new Queue('imageQueue', {
  connection
});

console.log('📦 BullMQ imageQueue initialized successfully');
