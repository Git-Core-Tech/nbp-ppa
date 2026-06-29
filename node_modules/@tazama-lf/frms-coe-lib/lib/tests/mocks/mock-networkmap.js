"use strict";
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseNetworkMapMocks = void 0;
/* eslint-disable @typescript-eslint/no-explicit-any */
const data_1 = require("../data");
const DatabaseNetworkMapMocks = (databaseManager) => {
    jest.spyOn(databaseManager, 'getNetworkMap').mockImplementation(async () => await Promise.resolve(data_1.NetworkMapSample));
};
exports.DatabaseNetworkMapMocks = DatabaseNetworkMapMocks;
//# sourceMappingURL=mock-networkmap.js.map