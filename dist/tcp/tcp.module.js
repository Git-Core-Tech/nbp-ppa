"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TcpModule = void 0;
const common_1 = require("@nestjs/common");
const tmi_module_1 = require("../tmi/tmi.module");
const tcp_listener_service_1 = require("./tcp-listener.service");
let TcpModule = class TcpModule {
};
exports.TcpModule = TcpModule;
exports.TcpModule = TcpModule = __decorate([
    (0, common_1.Module)({
        imports: [tmi_module_1.TmiModule],
        providers: [tcp_listener_service_1.TcpListenerService],
    })
], TcpModule);
//# sourceMappingURL=tcp.module.js.map