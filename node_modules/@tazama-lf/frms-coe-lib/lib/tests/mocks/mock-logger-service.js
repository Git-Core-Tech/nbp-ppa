"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockLoggerServiceFactory = MockLoggerServiceFactory;
const mock_base_1 = require("./mock-base");
/* -------------- Factory -------------- */
function MockLoggerServiceFactory() {
    // Create the object once, then fill in members (avoid touching undefined)
    const ls = new mock_base_1.MockBase();
    ls.seedDefaults = () => {
        ls.trace = jest.fn().mockImplementation(() => { });
        ls.debug = jest.fn().mockImplementation(() => { });
        ls.log = jest.fn().mockImplementation(() => { });
        ls.warn = jest.fn().mockImplementation(() => { });
        ls.error = jest.fn().mockImplementation(() => { });
        ls.fatal = jest.fn().mockImplementation(() => { });
    };
    // initialize defaults
    ls.resetMock();
    return ls;
}
//# sourceMappingURL=mock-logger-service.js.map