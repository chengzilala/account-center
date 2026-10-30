'use strict';

/**
 * 固定窗口限流。仅在单个实例内存里生效：
 * 单机 / 个人规模足够；将来多实例部署时换成共享存储（见接入契约 §4）。
 */
function createRateLimiter(now) {
  const buckets = new Map();

  return {
    hit(key, limit, windowMs) {
      const time = now();
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= time) {
        bucket = { count: 0, resetAt: time + windowMs };
        buckets.set(key, bucket);
      }
      if (bucket.count >= limit) {
        return {
          allowed: false,
          retryAfter: Math.max(1, Math.ceil((bucket.resetAt - time) / 1000))
        };
      }
      bucket.count += 1;
      return { allowed: true, retryAfter: 0 };
    },

    reset(key) {
      buckets.delete(key);
    }
  };
}

module.exports = { createRateLimiter };
