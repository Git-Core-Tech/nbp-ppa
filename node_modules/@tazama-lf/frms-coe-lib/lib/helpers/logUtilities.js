"use strict";
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.createElasticStream = createElasticStream;
const tslib_1 = require("tslib");
const ecs_pino_format_1 = require("@elastic/ecs-pino-format");
const pino_elasticsearch_1 = tslib_1.__importDefault(require("pino-elasticsearch"));
function createElasticStream(node, esVersion, username, password, flushBytes, index) {
    const streamToElastic = (0, pino_elasticsearch_1.default)({
        index,
        node,
        esVersion,
        auth: {
            username,
            password,
        },
        flushBytes,
    });
    const elasticOpts = (0, ecs_pino_format_1.ecsFormat)();
    return {
        stream: streamToElastic,
        ecsOpts: elasticOpts,
    };
}
//# sourceMappingURL=logUtilities.js.map