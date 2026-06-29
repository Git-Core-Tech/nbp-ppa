"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateRedisConfig = exports.Cache = void 0;
const _1 = require(".");
var Cache;
(function (Cache) {
    /** Distributed cache system. */
    Cache["DISTRIBUTED"] = "redisConfig";
    /** Node cache storing system. */
    Cache["LOCAL"] = "localCacheConfig";
})(Cache || (exports.Cache = Cache = {}));
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
const validateRedisConfig = (authEnabled) => {
    const password = (0, _1.validateEnvVar)('REDIS_AUTH', 'string', !authEnabled).toString();
    return {
        redisConfig: {
            db: Number((0, _1.validateEnvVar)('REDIS_DATABASE', 'number')),
            password,
            servers: JSON.parse((0, _1.validateEnvVar)('REDIS_SERVERS', 'string').toString()),
            isCluster: Boolean((0, _1.validateEnvVar)('REDIS_IS_CLUSTER', 'boolean')),
            distributedCacheEnabled: Boolean((0, _1.validateEnvVar)('DISTRIBUTED_CACHE_ENABLED', 'boolean', true)),
            distributedCacheTTL: Number((0, _1.validateEnvVar)('DISTRIBUTED_CACHETTL', 'number', true)),
        },
    };
};
exports.validateRedisConfig = validateRedisConfig;
//# sourceMappingURL=redis.config.js.map