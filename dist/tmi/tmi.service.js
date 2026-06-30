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
var TmiService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TmiService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const iso_service_1 = require("../iso/iso.service");
const tmi_parser_1 = require("./tmi-parser");
let TmiService = TmiService_1 = class TmiService {
    constructor(configService, isoService) {
        this.configService = configService;
        this.isoService = isoService;
        this.logger = new common_1.Logger(TmiService_1.name);
        const inputMode = this.configService.get('tmiInputMode') ??
            this.configService.get('TMI_INPUT_MODE') ??
            'trace';
        this.dotIsPadding = inputMode.toLowerCase() === 'trace';
    }
    async processRawString(raw) {
        const byteLength = Buffer.byteLength(raw, 'latin1');
        this.logger.log(`Received TMI body (${byteLength} bytes; expected ${tmi_parser_1.TMI_BODY_LENGTH}); Message: ${raw}`);
        if (byteLength !== tmi_parser_1.TMI_BODY_LENGTH) {
            throw new Error(`Invalid TMI body length: expected ${tmi_parser_1.TMI_BODY_LENGTH}, ` +
                `received ${byteLength}`);
        }
        const parsed = (0, tmi_parser_1.parseTmi1910)(raw, {
            dotIsPadding: this.dotIsPadding,
            validate: true,
        });
        this.logParsedTransaction(parsed);
        return this.isoService.processTransaction(parsed);
    }
    logParsedTransaction(parsed) {
        this.logger.log(`Parsed transaction: ` +
            `recordType=${parsed.record_type}, ` +
            `transactionId=${parsed.trs_txnid_1 || parsed.trs_txnid_2}, ` +
            `mti=${parsed.trs_msg_type}, ` +
            `processingCode=${parsed.trs_request_type}, ` +
            `amount=${parsed.trs_amount_orig || parsed.trs_amount_pan} ` +
            `${parsed.trs_curr_orig || parsed.trs_curr_pan}`);
        this.logger.debug(`Parsed TMI fields:\n${JSON.stringify(parsed, null, 2)}`);
    }
};
exports.TmiService = TmiService;
exports.TmiService = TmiService = TmiService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        iso_service_1.IsoService])
], TmiService);
//# sourceMappingURL=tmi.service.js.map