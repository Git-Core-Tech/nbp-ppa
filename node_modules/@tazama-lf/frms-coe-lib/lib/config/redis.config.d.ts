import type { ManagerConfig } from '../services/dbManager';
export declare enum Cache {
    /** Distributed cache system. */
    DISTRIBUTED = "redisConfig",
    /** Node cache storing system. */
    LOCAL = "localCacheConfig"
}
/**
 * Validates and retrieves the Redis configuration from environment variables.
 *
 * @param {boolean} authEnabled - Indicates whether authentication is enabled for Redis.
 * @returns {RedisConfig} - The validated Redis configuration.
 * @throws {Error} - Throws an error if required environment variables are not defined or invalid.
 *
 * @example
 * const redisConfig = validateRedisConfig(true);
 */
export declare const validateRedisConfig: (authEnabled: boolean) => ManagerConfig;
