"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TmiController = void 0;
const common_1 = require("@nestjs/common");
const tmi_service_1 = require("./tmi.service");
let TmiController = class TmiController {
    constructor(tmiService) {
        this.tmiService = tmiService;
    }
    healthCheck() {
        return { status: 'UP' };
    }
    health() {
        return { status: 'UP' };
    }
    async submitTransaction(payload) {
        return this.tmiService.processTransaction(payload);
    }
};
exports.TmiController = TmiController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], TmiController.prototype, "healthCheck", null);
__decorate([
    (0, common_1.Get)('/health'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], TmiController.prototype, "health", null);
__decorate([
    (0, common_1.Post)('/v1/transaction'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], TmiController.prototype, "submitTransaction", null);
exports.TmiController = TmiController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [tmi_service_1.TmiService])
], TmiController);
//# sourceMappingURL=tmi.controller.js.map