"use strict";
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisBuilder = redisBuilder;
const tslib_1 = require("tslib");
const util = tslib_1.__importStar(require("node:util"));
const __1 = require("..");
const dbManager_1 = require("../services/dbManager");
async function redisBuilder(manager, redisConfig) {
    try {
        const redis = await __1.RedisService.create(redisConfig);
        manager._redisClient = redis._redisClient;
        manager.getJson = async (...args) => await redis.getJson(...args);
        manager.getBuffer = async (...args) => await redis.getBuffer(...args);
        manager.getMemberValues = async (...args) => await redis.getMemberValues(...args);
        manager.deleteKey = async (...args) => {
            await redis.deleteKey(...args);
        };
        manager.setJson = async (...args) => {
            await redis.setJson(...args);
        };
        manager.set = async (...args) => {
            await redis.set(...args);
        };
        manager.setAdd = async (...args) => {
            await redis.setAdd(...args);
        };
        manager.addOneGetAll = async (...args) => await redis.addOneGetAll(...args);
        manager.addOneGetCount = async (...args) => await redis.addOneGetCount(...args);
        dbManager_1.readyChecks.Redis = 'Ok';
        return redis;
    }
    catch (error) {
        const err = error;
        dbManager_1.readyChecks.Redis = `err, ${util.inspect(err)}`;
    }
}
//# sourceMappingURL=redisBuilder.js.map