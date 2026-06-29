import { type Logger } from 'pino';
import type { ProcessorConfig } from '../config/processor.config';
import { type LogCallback } from '../helpers/logUtilities';
import type { LumberjackGRPCService } from './lumberjackGRPCService';
type LogFunc = (message: string, serviceOperation?: string, id?: string, callback?: LogCallback) => void;
export declare class LoggerService {
    log: LogFunc;
    debug: LogFunc;
    trace: LogFunc;
    warn: LogFunc;
    error: (message: string | Error, innerError?: unknown, serviceOperation?: string, id?: string, callback?: LogCallback) => void;
    logger: Console | Logger;
    lumberjackService: LumberjackGRPCService | undefined;
    constructor(processorConfig: ProcessorConfig);
    fatal(message: string | Error, innerError?: unknown, serviceOperation?: string, id?: string, callback?: LogCallback): void;
}
export {};
