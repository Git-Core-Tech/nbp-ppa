import type { DatabaseManagerInstance, ManagerConfig } from '..';
export declare const getIdsFromNetworkMaps: (databaseManager: DatabaseManagerInstance<Required<Pick<ManagerConfig, "configuration" | "localCacheConfig" | "redisConfig">>>) => Promise<{
    rulesIds: string[];
    typologyCfg: string[];
}>;
export declare const getRoutesFromNetworkMap: (databaseManager: DatabaseManagerInstance<Required<Pick<ManagerConfig, "configuration" | "localCacheConfig" | "redisConfig">>>, processor: string) => Promise<{
    consumers: string[];
}>;
