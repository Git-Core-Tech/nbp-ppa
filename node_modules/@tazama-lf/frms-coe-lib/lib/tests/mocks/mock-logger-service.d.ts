import type { LoggerService } from '../../services/logger';
import { MockBase } from './mock-base';
export type LoggerServiceMock = LoggerService & MockBase;
export declare function MockLoggerServiceFactory(): LoggerServiceMock;
