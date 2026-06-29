"use strict";
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.Apm = void 0;
const tslib_1 = require("tslib");
const elastic_apm_node_1 = tslib_1.__importDefault(require("elastic-apm-node"));
const monitoring_config_1 = require("../config/monitoring.config");
class Apm {
    #transaction = () => null;
    #span = () => null;
    #traceParent = () => null;
    constructor(apmConfig) {
        const config = (0, monitoring_config_1.validateAPMConfig)();
        if (config.apmActive) {
            const apmOptions = {
                active: config.apmActive,
                secretToken: config.apmSecretToken,
                serviceName: config.apmServiceName,
                serverUrl: config.apmUrl,
                ...apmConfig,
            };
            elastic_apm_node_1.default.start(apmOptions);
            this.#transaction = (name, options) => elastic_apm_node_1.default.startTransaction(name, options);
            this.#span = (name) => elastic_apm_node_1.default.startSpan(name);
            this.#traceParent = () => elastic_apm_node_1.default.currentTraceparent;
        }
    }
    startTransaction = (name, options) => this.#transaction(name, options);
    startSpan = (name) => this.#span(name);
    getCurrentTraceparent = () => this.#traceParent();
}
exports.Apm = Apm;
//# sourceMappingURL=apm.js.map