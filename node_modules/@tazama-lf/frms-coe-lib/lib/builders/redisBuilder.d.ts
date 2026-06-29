import { RedisService } from '..';
import type { RedisConfig } from '../interfaces';
import { type DatabaseManagerType } from '../services/dbManager';
export declare function redisBuilder(manager: DatabaseManagerType, redisConfig: RedisConfig): Promise<RedisService | undefined>;
