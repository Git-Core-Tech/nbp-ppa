"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateLogConfig = exports.validateAPMConfig = void 0;
const _1 = require(".");
/**
 * Validates and retrieves the APM configuration from environment variables.
 *
 * @returns {ApmConfig} - The validated APM configuration.
 * @throws {Error} - Throws an error if required environment variables are not defined or invalid.
 *
 * @example
 * const apmConfig = validateAPMConfig();
 */
const validateAPMConfig = () => ({
    apmActive: Boolean((0, _1.validateEnvVar)('APM_ACTIVE', 'boolean')),
    apmServiceName: (0, _1.validateEnvVar)('APM_SERVICE_NAME', 'string').toString(),
    apmSecretToken: (0, _1.validateEnvVar)('APM_SECRET_TOKEN', 'string', true).toString(),
    apmUrl: (0, _1.validateEnvVar)('APM_URL', 'string').toString(),
});
exports.validateAPMConfig = validateAPMConfig;
/**
 * Validates and retrieves the logging configuration from environment variables.
 *
 * @returns {LogConfig} - The validated logging configuration.
 * @throws {Error} - Throws an error if required environment variables are not defined or invalid.
 *
 * @example
 * const logConfig = validateLogConfig();
 */
const validateLogConfig = () => ({
    sidecarHost: (0, _1.validateEnvVar)('SIDECAR_HOST', 'string', true).toString(),
    logLevel: (0, _1.validateEnvVar)('LOG_LEVEL', 'string', true).toString() || 'info',
    pinoElasticOpts: {
        flushBytes: Number((0, _1.validateEnvVar)('ELASTIC_FLUSH_BYTES', 'number', true)),
        elasticUsername: (0, _1.validateEnvVar)('ELASTIC_USERNAME', 'string', true).toString(),
        elasticPassword: (0, _1.validateEnvVar)('ELASTIC_PASSWORD', 'string', true).toString(),
        elasticHost: (0, _1.validateEnvVar)('ELASTIC_HOST', 'string', true).toString(),
        elasticIndex: (0, _1.validateEnvVar)('ELASTIC_INDEX', 'string', true).toString(),
        elasticVersion: Number((0, _1.validateEnvVar)('ELASTIC_SEARCH_VERSION', 'number', true)),
    },
});
exports.validateLogConfig = validateLogConfig;
//# sourceMappingURL=monitoring.config.js.map