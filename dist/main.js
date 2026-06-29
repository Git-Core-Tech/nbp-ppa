"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
const core_1 = require("@nestjs/core");
const config_1 = require("@nestjs/config");
const common_1 = require("@nestjs/common");
const app_module_1 = require("./app.module");
(0, dotenv_1.config)();
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        transform: true,
    }));
    app.useBodyParser('text');
    const configService = app.get(config_1.ConfigService);
    const port = configService.get('port', 3003);
    await app.listen(port);
    console.log(`nbp-ppa listening on port ${port}`);
}
bootstrap().catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
});
//# sourceMappingURL=main.js.map