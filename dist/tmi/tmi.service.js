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
const tmi_parser_1 = require("../tcp/tmi-parser");
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
    async processRawString(raw) {
        this.logger.debug(`Raw message received (${raw.length} bytes)`);
        const parsed = (0, tmi_parser_1.parseTmi1910)(raw);
        this.logger.debug(`Parsed txnid=${parsed.trs_txnid_1} amount=${parsed.trs_amount_pan} ${parsed.trs_curr_pan}`);
        return this.process(this.buildColumnsFromParsed(parsed));
    }
    async processTransaction(dto) {
        return this.process(this.buildColumnsFromDto(dto));
    }
    async processRawBody(raw) {
        return this.processRawString(raw);
    }
    async process(columns) {
        const transactionId = columns[message_generation_1.Fields.MESSAGE_ID];
        this.logger.log(`Processing transaction ${transactionId}`);
        const pain001 = (0, message_generation_1.getPain001FromColumns)(columns, this.tenantId);
        const pain013 = (0, message_generation_1.getPain013FromPain001)(pain001);
        const pacs008 = (0, message_generation_1.getPacs008FromPain001)(pain001);
        const pacs002 = (0, message_generation_1.getPacs002FromColumns)(columns);
        const { TenantId: _t, ...pacs008Body } = pacs008;
        const [pacs008Result, pacs002Result] = await Promise.all([
            this.postToTms('pacs.008.001.10', pacs008Body),
            this.postToTms('pacs.002.001.12', pacs002),
        ]);
        const result = {
            transactionId,
            pain001: true,
            pain013: true,
            pacs008: pacs008Result,
            pacs002: pacs002Result,
        };
        if (pacs008Result && pacs002Result) {
            this.logger.log(`Transaction ${transactionId} submitted successfully`);
        }
        else {
            this.logger.warn(`Transaction ${transactionId} partial failure: ${JSON.stringify(result)}`);
        }
        return result;
    }
    buildColumnsFromParsed(p) {
        const columns = new Array(14).fill('');
        columns[message_generation_1.Fields.PROCESSING_DATE_TIME] = this.parseTimestamp(p.remote_time_sent);
        columns[message_generation_1.Fields.MESSAGE_ID] = p.trs_txnid_1;
        columns[message_generation_1.Fields.TRANSACTION_TYPE] = 'TRA';
        columns[message_generation_1.Fields.PAYMENT_CURRENCY_CODE] = p.trs_curr_pan;
        columns[message_generation_1.Fields.TOTAL_PAYMENT_AMOUNT] = p.trs_amount_pan;
        columns[message_generation_1.Fields.SENDER_ID] = p.trs_account;
        columns[message_generation_1.Fields.SENDER_NAME] = p.org_code;
        columns[message_generation_1.Fields.RECEIVER_ID] = p.destination_account;
        columns[message_generation_1.Fields.RECEIVER_NAME] = p.secondary_org_code;
        columns[message_generation_1.Fields.SENDER_AGENT_SPID] = p.org_code;
        columns[message_generation_1.Fields.RECEIVER_AGENT_SPID] = p.secondary_org_code;
        columns[message_generation_1.Fields.SENDER_ACCOUNT] = p.trs_account;
        columns[message_generation_1.Fields.RECEIVER_ACCOUNT] = p.destination_account;
        columns[message_generation_1.Fields.REPORTING_CODE] = p.trs_mer_code || p.trs_mcc;
        return columns;
    }
    buildColumnsFromDto(dto) {
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
        const s = ts.padStart(14, '0');
        return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}${this.timezoneOffset}`;
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