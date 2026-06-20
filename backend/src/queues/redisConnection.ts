import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const redisConnection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
});

redisConnection.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
});
