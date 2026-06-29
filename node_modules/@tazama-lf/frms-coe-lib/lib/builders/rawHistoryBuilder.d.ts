import { type DBConfig, type RawHistoryDB } from '../services/dbManager';
export declare function rawHistoryBuilder(manager: RawHistoryDB, rawHistoryConfig: DBConfig): Promise<void>;
