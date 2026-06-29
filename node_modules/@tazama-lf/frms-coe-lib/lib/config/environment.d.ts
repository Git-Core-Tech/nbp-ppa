/**
 * Validates and retrieves the specified environment variable.
 *
 * @param {string} name - The name of the environment variable to validate.
 * @param {'string' | 'number' | 'boolean'} type - The expected type of the environment variable.
 * @param {boolean} optional - Is this variable optional (Defaults to false)
 * @returns {'string' | 'number' | 'boolean'} - The value of the environment variable, cast to the specified type.
 * @throws {Error} - Throws an error if the environment variable is not defined, or if the value cannot be converted to the specified type.
 *
 * @example
 * const port = validateEnvVar('PORT', 'number');
 * const env = validateEnvVar('NODE_ENV', 'string');
 * const apiKey = validateEnvVar('API_KEY', 'string', true);
 */
export declare function validateEnvVar(name: string, type: 'string' | 'number' | 'boolean', optional?: boolean): string | number | boolean;
