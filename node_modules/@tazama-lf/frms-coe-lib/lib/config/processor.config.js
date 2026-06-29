"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateProcessorConfig = void 0;
const _1 = require(".");
/**
 * Validates and retrieves the processor configuration from environment variables.
 *
 * @returns {ProcessorConfig} - The validated processor configuration.
 * @throws {Error} - Throws an error if required environment variables are not defined or invalid.
 *
 * @example
 * const processorConfig = validateProcessorConfig(additionalEnvironmentVariables?: additionalConfig[]);
 */
const validateProcessorConfig = (additionalEnvironmentVariables) => {
    //Additional Environment variables
    const valueAndVariablesName = additionalEnvironmentVariables?.map((value) => ({
        value: (0, _1.validateEnvVar)(value.name, value.type, value.optional),
        name: value.name,
    }));
    // reduce array of object to object of config
    const _additionalConfiguration = valueAndVariablesName?.reduce((acc, item) => {
        acc[item.name] = item.value;
        return acc;
    }, {});
    const nodeEnv = (0, _1.validateEnvVar)('NODE_ENV', 'string');
    if (nodeEnv !== 'dev' && nodeEnv !== 'production' && nodeEnv !== 'test') {
        throw new Error('Environment variable NODE_ENV is not valid. Expected "dev", "production" or "test".');
    }
    const maxCPU = process.env.MAX_CPU ?? '1';
    if (isNaN(Number(maxCPU))) {
        throw new Error('The value specified for MAX_CPU is not a number.');
    }
    const _processorConfig = {
        maxCPU: parseInt(maxCPU, 10),
        functionName: (0, _1.validateEnvVar)('FUNCTION_NAME', 'string').toString(),
        nodeEnv,
    };
    return { ..._processorConfig, ..._additionalConfiguration };
};
exports.validateProcessorConfig = validateProcessorConfig;
//# sourceMappingURL=processor.config.js.map