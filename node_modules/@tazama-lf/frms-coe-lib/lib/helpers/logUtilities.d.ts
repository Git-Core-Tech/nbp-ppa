import type { LoggerOptions } from 'pino';
import { type DestinationStream } from 'pino-elasticsearch';
interface ElasticLogger {
    stream: DestinationStream;
    ecsOpts: LoggerOptions;
}
export declare function createElasticStream(node: string, esVersion: number, username: string, password: string, flushBytes: number, index?: string): ElasticLogger;
export type LogCallback = (...args: unknown[]) => unknown;
export {};
