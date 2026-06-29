"use strict";
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoggerService = void 0;
const tslib_1 = require("tslib");
const pino_1 = tslib_1.__importDefault(require("pino"));
const index_1 = require("../config/index");
const logUtilities_1 = require("../helpers/logUtilities");
const config = (0, index_1.validateLogConfig)();
const pinoStream = () => {
    if (config.pinoElasticOpts?.elasticHost.length) {
        const { stream } = (0, logUtilities_1.createElasticStream)(config.pinoElasticOpts.elasticHost, config.pinoElasticOpts.elasticVersion, config.pinoElasticOpts.elasticUsername, config.pinoElasticOpts.elasticPassword, config.pinoElasticOpts.flushBytes, config.pinoElasticOpts.elasticIndex);
        return stream;
    }
};
const LOGLEVEL = config.logLevel.toLowerCase();
const createErrorFn = (logger, grpcClient) => (message, innerError, serviceOperation, id, callback) => {
    let errMessage = typeof message === 'string' ? message : (message.stack ?? message.message);
    if (innerError) {
        if (innerError instanceof Error) {
            errMessage = `${errMessage}\r\n${innerError.stack ?? innerError.message}`;
        }
        else if (typeof innerError === 'string') {
            errMessage = `${errMessage}\r\n${innerError}`;
        }
    }
    if (grpcClient) {
        grpcClient.log(errMessage, 'error', serviceOperation, id, callback);
    }
    else {
        logger.error({ message: errMessage, serviceOperation, id });
    }
};
const createLogCallback = (level, logger, grpcClient) => {
    switch (level) {
        case 'trace':
            return (message, serviceOperation, id, callback) => {
                if (grpcClient) {
                    grpcClient.log(message, level, serviceOperation, id, callback);
                }
                else {
                    logger.trace({ message, serviceOperation, id });
                }
            };
        case 'debug':
            return (message, serviceOperation, id, callback) => {
                if (grpcClient) {
                    grpcClient.log(message, level, serviceOperation, id, callback);
                }
                else {
                    logger.debug({ message, serviceOperation, id });
                }
            };
        case 'warn':
            return (message, serviceOperation, id, callback) => {
                if (grpcClient) {
                    grpcClient.log(message, level, serviceOperation, id, callback);
                }
                else {
                    logger.warn({ message, serviceOperation, id });
                }
            };
        case 'fatal':
            return (message, serviceOperation, id, callback) => {
                if (grpcClient) {
                    grpcClient.log(message, level, serviceOperation, id, callback);
                }
                else {
                    // NOTE: 'fatal(...)' method is not available on a `console` logger
                    logger.error({ message, serviceOperation, id });
                }
            };
        default:
            return (message, serviceOperation, id, callback) => {
                if (grpcClient) {
                    grpcClient.log(message, 'info', serviceOperation, id, callback);
                }
                else {
                    logger.info({ message, serviceOperation, id });
                }
            };
    }
};
class LoggerService {
    /* Fields representing methods for different log levels
     *
     * Each field is by default `null`, see `constructor()` for how each log level is set */
    log = () => null;
    debug = () => null;
    trace = () => null;
    warn = () => null;
    error = () => null;
    logger;
    /* for enabling logging through the sidecar */
    lumberjackService = undefined;
    constructor(processorConfig) {
        const config = (0, index_1.validateLogConfig)();
        if (processorConfig.nodeEnv === 'dev' || processorConfig.nodeEnv === 'test') {
            this.logger = console;
        }
        else {
            this.logger = (0, pino_1.default)({ level: LOGLEVEL }, pinoStream());
        }
        switch (config.logLevel.toLowerCase()) {
            // error > warn > info > debug > trace
            case 'trace':
                this.trace = createLogCallback('trace', this.logger, this.lumberjackService);
                this.debug = createLogCallback('debug', this.logger, this.lumberjackService);
                this.log = createLogCallback('info', this.logger, this.lumberjackService);
                this.warn = createLogCallback('warn', this.logger, this.lumberjackService);
                this.error = createErrorFn(this.logger, this.lumberjackService);
                break;
            case 'debug':
                this.debug = createLogCallback('debug', this.logger, this.lumberjackService);
                this.log = createLogCallback('info', this.logger, this.lumberjackService);
                this.warn = createLogCallback('warn', this.logger, this.lumberjackService);
                this.error = createErrorFn(this.logger, this.lumberjackService);
                break;
            case 'info':
                this.log = createLogCallback('info', this.logger, this.lumberjackService);
                this.warn = createLogCallback('warn', this.logger, this.lumberjackService);
                this.error = createErrorFn(this.logger, this.lumberjackService);
                break;
            case 'warn':
                this.warn = createLogCallback('warn', this.logger, this.lumberjackService);
                this.error = createErrorFn(this.logger, this.lumberjackService);
                break;
            case 'error':
                this.error = createErrorFn(this.logger, this.lumberjackService);
                break;
            case 'fatal':
                this.error = createErrorFn(this.logger, this.lumberjackService);
                break;
            default:
                break;
        }
    }
    fatal(message, innerError, serviceOperation, id, callback) {
        this.error(message, innerError, serviceOperation, id, callback);
    }
}
exports.LoggerService = LoggerService;
//# sourceMappingURL=logger.js.map