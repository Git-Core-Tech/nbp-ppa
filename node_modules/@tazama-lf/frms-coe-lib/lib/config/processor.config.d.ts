/**
 * Interface representing the configuration for a processor.
 */
export interface ProcessorConfig {
    /** The maximum CPU allocation for the processor. */
    maxCPU: number;
    /** The name of the function to be processed. */
    functionName: string;
    /** The environment in which the application is running. */
    nodeEnv: string;
}
export interface AdditionalConfig {
    name: string;
    type: 'string' | 'boolean' | 'number';
    optional?: boolean;
}
/**
 * Validates and retrieves the processor configuration from environment variables.
 *
 * @returns {ProcessorConfig} - The validated processor configuration.
 * @throws {Error} - Throws an error if required environment variables are not defined or invalid.
 *
 * @example
 * const processorConfig = validateProcessorConfig(additionalEnvironmentVariables?: additionalConfig[]);
 */
export declare const validateProcessorConfig: (additionalEnvironmentVariables?: AdditionalConfig[]) => ProcessorConfig;
