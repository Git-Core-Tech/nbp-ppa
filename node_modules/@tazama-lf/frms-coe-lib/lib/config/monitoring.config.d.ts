/**
 * Interface representing the configuration for APM (Application Performance Monitoring).
 */
export interface ApmConfig {
    /** Indicates whether APM is active. */
    apmActive: boolean;
    /** The name of the APM service. */
    apmServiceName: string;
    /** The URL for the APM server. */
    apmUrl: string;
    /** The secret token for APM authentication. */
    apmSecretToken: string;
}
/**
 * Interface representing the configuration for logging.
 */
export interface LogConfig {
    /** The host of the logging sidecar. */
    sidecarHost?: string;
    logLevel: string;
    pinoElasticOpts?: {
        flushBytes: number;
        elasticUsername: string;
        elasticPassword: string;
        elasticHost: string;
        elasticIndex: string;
        elasticVersion: number;
    };
}
/**
 * Validates and retrieves the APM configuration from environment variables.
 *
 * @returns {ApmConfig} - The validated APM configuration.
 * @throws {Error} - Throws an error if required environment variables are not defined or invalid.
 *
 * @example
 * const apmConfig = validateAPMConfig();
 */
export declare const validateAPMConfig: () => ApmConfig;
/**
 * Validates and retrieves the logging configuration from environment variables.
 *
 * @returns {LogConfig} - The validated logging configuration.
 * @throws {Error} - Throws an error if required environment variables are not defined or invalid.
 *
 * @example
 * const logConfig = validateLogConfig();
 */
export declare const validateLogConfig: () => LogConfig;
