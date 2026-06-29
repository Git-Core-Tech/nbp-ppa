"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockBase = void 0;
class MockBase {
    seedDefaults() { }
    resetMock() {
        this.resetMocksDeep(this);
        this.seedDefaults();
    }
    resetOne(fn) {
        if (typeof fn.mockReset === 'function') {
            fn.mockReset();
            return;
        }
        if (typeof fn.mockClear === 'function') {
            fn.mockClear();
        }
    }
    resetMocksDeep(obj, seen = new WeakSet()) {
        if (this == null)
            return;
        // If it's a jest mock function, reset it
        if (typeof obj === 'function' && obj._isMockFunction) {
            this.resetOne(obj);
            return;
        }
        // Recurse into objects/arrays/maps/sets
        if (typeof obj === 'object') {
            const o = obj;
            if (seen.has(o))
                return;
            seen.add(o);
            // Arrays
            if (Array.isArray(o)) {
                for (const v of o)
                    this.resetMocksDeep(v, seen);
                return;
            }
            // Maps/Sets
            if (o instanceof Map) {
                for (const v of o.values())
                    this.resetMocksDeep(v, seen);
                return;
            }
            if (o instanceof Set) {
                for (const v of o.values())
                    this.resetMocksDeep(v, seen);
                return;
            }
            // Plain objects (own props + symbols)
            for (const key of [...Object.getOwnPropertyNames(o), ...Object.getOwnPropertySymbols(o)]) {
                // Guard try/catch in case a getter throws
                try {
                    this.resetMocksDeep(o[key], seen);
                }
                catch {
                    /* ignore inaccessible getters */
                }
            }
        }
    }
}
exports.MockBase = MockBase;
//# sourceMappingURL=mock-base.js.map