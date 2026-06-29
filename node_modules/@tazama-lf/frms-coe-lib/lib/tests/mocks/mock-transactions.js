"use strict";
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseManagerMocks = exports.CacheDatabaseClientMocks = void 0;
const data_1 = require("../data");
const pacs008_1 = require("../data/pacs008");
/* eslint-disable @typescript-eslint/no-explicit-any */
const CacheDatabaseClientMocks = (cacheDatabaseClient) => {
    jest.spyOn(cacheDatabaseClient, 'addAccount').mockImplementation(async () => {
        await Promise.resolve();
    });
    jest.spyOn(cacheDatabaseClient, 'addEntity').mockImplementation(async () => {
        await Promise.resolve();
    });
    jest.spyOn(cacheDatabaseClient, 'addAccountHolder').mockImplementation(async () => {
        await Promise.resolve();
    });
    jest.spyOn(cacheDatabaseClient, 'saveTransactionDetails').mockImplementation(async () => {
        await Promise.resolve();
    });
    jest.spyOn(cacheDatabaseClient, 'saveTransactionHistory').mockImplementation(async () => {
        await Promise.resolve();
    });
};
exports.CacheDatabaseClientMocks = CacheDatabaseClientMocks;
const DatabaseManagerMocks = (databaseManager, cacheString) => {
    // Database raw History Mocks
    if (databaseManager.isReadyCheck()?.rawHistory === 'Ok') {
        jest.spyOn(databaseManager, 'getTransactionPacs008').mockImplementation(async (event) => await Promise.resolve([[pacs008_1.Pacs008Sample]]));
    }
    // Database Network Map Mocks
    if (databaseManager.isReadyCheck()?.networkMap === 'Ok') {
        jest.spyOn(databaseManager, 'getNetworkMap').mockImplementation(async () => await Promise.resolve(data_1.NetworkMapSample));
    }
    if (databaseManager.isReadyCheck()?.configuration === 'Ok') {
        jest.spyOn(databaseManager, 'getNetworkMap').mockImplementation(async () => await Promise.resolve(data_1.NetworkMapSample));
    }
    // Redis Mocks
    if (databaseManager.isReadyCheck()?.Redis === 'Ok') {
        jest.spyOn(databaseManager, 'setJson').mockImplementation(async () => {
            await Promise.resolve();
        });
    }
};
exports.DatabaseManagerMocks = DatabaseManagerMocks;
//# sourceMappingURL=mock-transactions.js.map