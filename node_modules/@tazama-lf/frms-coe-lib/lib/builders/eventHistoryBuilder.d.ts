import type { DBConfig, EventHistoryDB } from '../services/dbManager';
export declare function eventHistoryBuilder(manager: EventHistoryDB, eventHistoryConfig: DBConfig): Promise<void>;
