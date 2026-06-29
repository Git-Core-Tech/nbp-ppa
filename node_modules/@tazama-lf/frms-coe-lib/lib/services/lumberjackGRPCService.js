"use strict";
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.LumberjackGRPCService = void 0;
const tslib_1 = require("tslib");
const grpc = tslib_1.__importStar(require("@grpc/grpc-js"));
const protoLoader = tslib_1.__importStar(require("@grpc/proto-loader"));
const node_path_1 = tslib_1.__importDefault(require("node:path"));
const PROTO_PATH = node_path_1.default.join(__dirname, '../helpers/proto/Lumberjack.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
});
const LogProto = grpc.loadPackageDefinition(packageDefinition).lumberjack.Lumberjack;
class LumberjackGRPCService {
    client;
    channel;
    constructor(host, channel) {
        this.client = new LogProto(host, grpc.credentials.createInsecure());
        this.channel = channel;
    }
    makeMessage(message, level, serviceOperation, id) {
        return {
            message,
            level,
            channel: this.channel,
            serviceOperation,
            id,
        };
    }
    log(message, level, serviceOperation, id, callback) {
        const object = this.makeMessage(message, level, serviceOperation, id);
        if (callback) {
            this.client.sendLog(object, callback);
        }
        else {
            this.client.sendLog(object, () => {
                // no callback provided
            });
        }
    }
}
exports.LumberjackGRPCService = LumberjackGRPCService;
//# sourceMappingURL=lumberjackGRPCService.js.map