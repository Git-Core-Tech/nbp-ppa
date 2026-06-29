"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockDatabaseManagerFactory = MockDatabaseManagerFactory;
const mock_base_1 = require("./mock-base");
/* ---------- Mock Factories ---------- */
function eventHistoryMockFactory() {
    return {
        query: jest.fn().mockResolvedValue({ rows: [] }),
    };
}
function rawHistoryMockFactory() {
    return {
        query: jest.fn().mockResolvedValue({ rows: [] }),
    };
}
function MockDatabaseManagerFactory() {
    // Create the object once, then fill in members (avoid touching undefined)
    const dm = new mock_base_1.MockBase();
    dm._eventHistory = eventHistoryMockFactory();
    dm._rawHistory = rawHistoryMockFactory();
    dm.isReadyCheck = jest.fn().mockReturnValue('');
    dm.quit = jest.fn().mockImplementation(() => { });
    dm.seedDefaults = () => {
        dm._eventHistory.query.mockResolvedValue({ rows: [] });
        dm._rawHistory.query.mockResolvedValue({ rows: [] });
        dm.isReadyCheck.mockReturnValue('');
        dm.quit.mockImplementation(() => { });
    };
    // initialize defaults
    dm.resetMock();
    return dm;
}
//# sourceMappingURL=mock-database-manager.js.map