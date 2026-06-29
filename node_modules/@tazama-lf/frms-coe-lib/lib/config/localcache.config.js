"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateLocalCacheConfig = void 0;
const _1 = require(".");
/**
 * Validates and retrieves the Local cache options configuration from environment variables.
 *
 * @returns {LocalCacheConfig} - The validated LocalCacheConfig configuration.
 * @throws {Error} - Throws an error if required environment variables are not defined or invalid.
 *
 * @example
 * const localCacheOptions = validateLocalCacheConfig();
 */
const validateLocalCacheConfig = () => {
    const localCacheConfig = {
        localCacheConfig: {
            localCacheEnabled: Boolean((0, _1.validateEnvVar)('LOCAL_CACHE_ENABLED', 'boolean', true)),
            localCacheTTL: Number((0, _1.validateEnvVar)('LOCAL_CACHETTL', 'number', true)),
        },
    };
    return {
        ...localCacheConfig,
    };
};
exports.validateLocalCacheConfig = validateLocalCacheConfig;
//# sourceMappingURL=localcache.config.js.map