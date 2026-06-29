import type { LumberjackClient } from '../helpers/proto/lumberjack/Lumberjack';
import type { LogLevel } from '../helpers/proto/lumberjack/LogLevel';
import type { LogMessage } from '../helpers/proto/lumberjack/LogMessage';
export declare class LumberjackGRPCService {
    readonly client: LumberjackClient;
    readonly channel: string;
    constructor(host: string, channel: string);
    makeMessage(message: string, level?: LogLevel, serviceOperation?: string, id?: string): LogMessage;
    log(message: string, level?: LogLevel, serviceOperation?: string, id?: string, callback?: (...args: unknown[]) => unknown): void;
}
