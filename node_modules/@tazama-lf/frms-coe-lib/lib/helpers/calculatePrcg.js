"use strict";
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.CalculateDuration = void 0;
/**
 * Calculation the difference of execution time in nano seconds
 *
 * @param {startTime: bigint} startTime Start time that was the initial cater time
 * @returns {number} differce of argument bigint passed to now
 */
const CalculateDuration = (startTime) => {
    const endTime = process.hrtime.bigint();
    return Number(endTime - startTime);
};
exports.CalculateDuration = CalculateDuration;
exports.default = exports.CalculateDuration;
//# sourceMappingURL=calculatePrcg.js.map