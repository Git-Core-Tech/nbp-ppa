"use strict";
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRoutesFromNetworkMap = exports.getIdsFromNetworkMaps = void 0;
function getRuleMap(networkMap) {
    const rulesIds = new Array();
    const typologyCfg = new Array();
    for (const Message of networkMap.messages) {
        for (const typology of Message.typologies) {
            if (!typologyCfg.includes(typology.cfg))
                typologyCfg.push(typology.cfg);
            for (const rule of typology.rules) {
                if (!rulesIds.includes(rule.id))
                    rulesIds.push(rule.id);
            }
        }
    }
    return { rulesIds, typologyCfg };
}
const getIdsFromNetworkMaps = async (databaseManager) => {
    let ruleIds = [];
    let typologyCfg = [];
    const networkMaps = await databaseManager.getNetworkMap();
    for (const networkMap of networkMaps) {
        const ruleMaps = getRuleMap(networkMap);
        ruleIds = [...ruleIds, ...ruleMaps.rulesIds];
        typologyCfg = [...typologyCfg, ...ruleMaps.typologyCfg];
    }
    return {
        rulesIds: ruleIds,
        typologyCfg,
    };
};
exports.getIdsFromNetworkMaps = getIdsFromNetworkMaps;
const getRoutesFromNetworkMap = async (databaseManager, processor) => {
    const { typologyCfg, rulesIds } = await (0, exports.getIdsFromNetworkMaps)(databaseManager);
    switch (processor) {
        case 'typology-processor':
            return {
                consumers: rulesIds.map((eachRuleId) => 'pub-rule-' + eachRuleId),
            };
        case 'transaction-aggregation-decisioning-processor':
            return {
                consumers: typologyCfg.map((eachTypologyCfg) => 'typology-' + eachTypologyCfg),
            };
        default:
            return { consumers: [''] };
    }
};
exports.getRoutesFromNetworkMap = getRoutesFromNetworkMap;
//# sourceMappingURL=networkMapIdentifiers.js.map