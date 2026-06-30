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
        this.logger.log(`Complete message length: ${raw.length} bytes (expected ${tmi_parser_1.TMI_MESSAGE_LENGTH})`);
        if (raw.length !== tmi_parser_1.TMI_MESSAGE_LENGTH) {
            this.logger.warn(`Length mismatch — skipping`);
            return JSON.stringify({ error: `Expected ${tmi_parser_1.TMI_MESSAGE_LENGTH} bytes, got ${raw.length}` });
        }
        const parsed = (0, tmi_parser_1.parseTmi1910)(raw);
        this.logger.log(`Parsed TMI: txnid=${parsed.trs_txnid_1} amount=${parsed.trs_amount_pan} ${parsed.trs_curr_pan} sender=${parsed.trs_account} receiver=${parsed.destination_account}`);
        const result = await this.processTransaction(parsed);
        return JSON.stringify(result);
    }
    async processTransaction(parsed) {
        const columns = this.buildColumns(parsed);
        const transactionId = columns[message_generation_1.Fields.MESSAGE_ID];
        this.logger.log(`Processing transaction ${transactionId}`);
        const pain001 = (0, message_generation_1.getPain001FromColumns)(columns, this.tenantId);
        const pain013 = (0, message_generation_1.getPain013FromPain001)(pain001);
        const pacs008 = (0, message_generation_1.getPacs008FromPain001)(pain001);
        const pacs002 = (0, message_generation_1.getPacs002FromColumns)(columns);
        this.logger.log(`Generated pain.001 msgId=${pain001.CstmrCdtTrfInitn.GrpHdr.MsgId}`);
        this.logger.log(`Generated pain.013 msgId=${pain013.CdtrPmtActvtnReq.GrpHdr.MsgId}`);
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
    buildColumns(p) {
        const columns = new Array(14).fill('');
        columns[message_generation_1.Fields.PROCESSING_DATE_TIME] = this.parseTimestamp(p.remote_time_sent);
        columns[message_generation_1.Fields.MESSAGE_ID] = p.trs_txnid_1;
        columns[message_generation_1.Fields.TRANSACTION_TYPE] = 'TRA';
        columns[message_generation_1.Fields.PAYMENT_CURRENCY_CODE] = p.trs_curr_pan;
        columns[message_generation_1.Fields.TOTAL_PAYMENT_AMOUNT] = Number(p.trs_amount_pan).toFixed(2);
        columns[message_generation_1.Fields.SENDER_ID] = p.trs_account;
        columns[message_generation_1.Fields.SENDER_NAME] = p.org_code;
        columns[message_generation_1.Fields.RECEIVER_ID] = p.destination_account;
        columns[message_generation_1.Fields.RECEIVER_NAME] = p.correspondent_name || p.secondary_org_code;
        columns[message_generation_1.Fields.SENDER_AGENT_SPID] = p.org_code;
        columns[message_generation_1.Fields.RECEIVER_AGENT_SPID] = p.secondary_org_code;
        columns[message_generation_1.Fields.SENDER_ACCOUNT] = p.trs_account;
        columns[message_generation_1.Fields.RECEIVER_ACCOUNT] = p.destination_account;
        columns[message_generation_1.Fields.REPORTING_CODE] = p.trs_mer_code || p.trs_mcc || '';
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
            const headers = { 'Content-Type': 'application/json' };
            if (this.authHeader)
                headers['Authorization'] = this.authHeader;
            const response = await axios_1.default.post(url, payload, { headers });
            this.logger.log(`TMS ${txType} → HTTP ${response.status}`);
            return response.status === 200;
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