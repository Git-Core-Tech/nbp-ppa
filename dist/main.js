"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
(0, dotenv_1.config)();
async function bootstrap() {
    await core_1.NestFactory.createApplicationContext(app_module_1.AppModule, { logger: ['log', 'warn', 'error', 'debug'] });
}
bootstrap().catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
});
//# sourceMappingURL=main.js.map