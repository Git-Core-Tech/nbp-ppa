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
const axios_1 = require("axios");
const message_generation_1 = require("../iso/message-generation");
let TmiService = TmiService_1 = class TmiService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(TmiService_1.name);
        this.tmsEndpoint = this.configService.get('tmsEndpoint', 'http://localhost:5000');
        this.tenantId = this.configService.get('tenantId', 'DEFAULT');
        this.timezoneOffset = this.configService.get('timezoneOffset', '+05:00');
        const authenticated = this.configService.get('authenticated', false);
        const authToken = this.configService.get('authToken', '');
        this.authHeader = authenticated && authToken ? `Bearer ${authToken}` : undefined;
    }
    async processTransaction(payload) {
        console.log(payload);
        return payload;
    }
    buildColumns(dto) {
        const columns = new Array(14).fill('');
        columns[message_generation_1.Fields.PROCESSING_DATE_TIME] = this.parseTimestamp(String(dto.remote_time_sent));
        columns[message_generation_1.Fields.MESSAGE_ID] = dto.trs_txnid_1;
        columns[message_generation_1.Fields.TRANSACTION_TYPE] = 'TRA';
        columns[message_generation_1.Fields.PAYMENT_CURRENCY_CODE] = dto.trs_curr_pan;
        columns[message_generation_1.Fields.TOTAL_PAYMENT_AMOUNT] = Number(dto.trs_amount_pan).toFixed(2);
        columns[message_generation_1.Fields.SENDER_ID] = dto.trs_account;
        columns[message_generation_1.Fields.SENDER_NAME] = dto.sender_name ?? dto.org_code;
        columns[message_generation_1.Fields.RECEIVER_ID] = dto.destination_account;
        columns[message_generation_1.Fields.RECEIVER_NAME] = dto.receiver_name ?? dto.secondary_org_code;
        columns[message_generation_1.Fields.SENDER_AGENT_SPID] = dto.org_code;
        columns[message_generation_1.Fields.RECEIVER_AGENT_SPID] = dto.secondary_org_code;
        columns[message_generation_1.Fields.SENDER_ACCOUNT] = dto.trs_account;
        columns[message_generation_1.Fields.RECEIVER_ACCOUNT] = dto.destination_account;
        columns[message_generation_1.Fields.REPORTING_CODE] = String(dto.trs_mer_code ?? dto.trs_mcc ?? '');
        return columns;
    }
    parseTimestamp(ts) {
        const padded = ts.padStart(14, '0');
        const yyyy = padded.slice(0, 4);
        const MM = padded.slice(4, 6);
        const dd = padded.slice(6, 8);
        const HH = padded.slice(8, 10);
        const mm = padded.slice(10, 12);
        const ss = padded.slice(12, 14);
        return `${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}${this.timezoneOffset}`;
    }
    async postToTms(txType, payload) {
        const url = `${this.tmsEndpoint}/v1/evaluate/iso20022/${txType}`;
        try {
            const headers = this.authHeader ? { Authorization: this.authHeader } : undefined;
            const response = await axios_1.default.post(url, payload, { headers });
            if (response.status !== 200) {
                this.logger.error(`TMS returned ${response.status} for ${txType}`);
                return false;
            }
            return true;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`Failed to POST ${txType} to TMS: ${msg}`);
            return false;
        }
    }
};
exports.TmiService = TmiService;
exports.TmiService = TmiService = TmiService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], TmiService);
//# sourceMappingURL=tmi.service.js.map