import type { Pool } from 'pg';
import type { DatabaseManagerInstance, ManagerConfig } from '../../services/dbManager';
import { MockBase } from './mock-base';
/** Replace only the query signature; everything else on EventHistoryDB is optional. */
type EventHistoryMock = Omit<Pool, 'query'> & {
    query: jest.Mock;
};
/** Replace only the query signature; everything else on RawHistoryDB is optional. */
type RawHistoryMock = Omit<Pool, 'query'> & {
    query: jest.Mock;
};
export type DatabaseManagerMock<T extends ManagerConfig> = DatabaseManagerInstance<T> & MockBase & {
    _eventHistory: EventHistoryMock;
    _rawHistory: RawHistoryMock;
    isReadyCheck: jest.Mock<string | Promise<string>, []>;
    quit: jest.Mock<void | Promise<void>, []>;
};
export declare function MockDatabaseManagerFactory<T extends ManagerConfig>(): DatabaseManagerMock<T>;
export {};
