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
var TcpListenerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TcpListenerService = void 0;
const net = require("net");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const tmi_service_1 = require("../tmi/tmi.service");
const tmi_parser_1 = require("../tmi/tmi-parser");
let TcpListenerService = TcpListenerService_1 = class TcpListenerService {
    constructor(tmiService, configService) {
        this.tmiService = tmiService;
        this.configService = configService;
        this.logger = new common_1.Logger(TcpListenerService_1.name);
        this.tcpPort = Number(this.configService.get('tcpPort') ??
            this.configService.get('TCP_PORT') ??
            3004);
        this.tcpHost =
            this.configService.get('tcpHost') ??
                this.configService.get('TCP_HOST') ??
                '0.0.0.0';
        if (!Number.isInteger(this.tcpPort) || this.tcpPort <= 0) {
            throw new Error(`Invalid TCP port: ${this.tcpPort}`);
        }
    }
    onModuleInit() {
        this.server = net.createServer((socket) => this.handleConnection(socket));
        this.server.listen(this.tcpPort, this.tcpHost, () => {
            this.logger.log(`TCP server listening on ${this.tcpHost}:${this.tcpPort} ` +
                `[Fractals trace -> ${tmi_parser_1.TMI_BODY_LENGTH}-byte TMI body]`);
        });
        this.server.on('error', (error) => {
            this.logger.error(`TCP server error: ${error.message}`);
        });
    }
    onModuleDestroy() {
        this.server?.close(() => {
            this.logger.log('TCP server closed');
        });
    }
    handleConnection(socket) {
        const remote = `${socket.remoteAddress}:${socket.remotePort}`;
        this.logger.log(`Client connected: ${remote}`);
        let traceBuffer = '';
        let processingQueue = Promise.resolve();
        socket.on('data', (chunk) => {
            this.logger.log(`Received ${chunk.length} bytes from ${remote}: ${chunk}`);
            traceBuffer += chunk.toString('latin1');
            const messages = this.drainTraceMessages(traceBuffer);
            traceBuffer = messages.remaining;
            this.logger.log(`Complete TMI messages: ${messages.complete.length}, ` +
                `remaining trace bytes: ${Buffer.byteLength(traceBuffer, 'latin1')}`);
            for (const message of messages.complete) {
                processingQueue = processingQueue
                    .then(() => this.dispatch(socket, message))
                    .catch((error) => {
                    const text = error instanceof Error ? error.message : String(error);
                    this.logger.error(`Processing queue failed [${remote}]: ${text}`);
                });
            }
        });
        socket.on('end', () => {
            if (traceBuffer.length > 0) {
                this.logger.debug(`Ignoring ${Buffer.byteLength(traceBuffer, 'latin1')} ` +
                    'remaining non-payload trace bytes');
                traceBuffer = '';
            }
            this.logger.log(`Client disconnected: ${remote}`);
        });
        socket.on('error', (error) => {
            this.logger.error(`Socket error [${remote}]: ${error.message}`);
        });
    }
    drainTraceMessages(buffer) {
        const complete = [];
        let searchOffset = 0;
        while (searchOffset < buffer.length) {
            const searchable = buffer.slice(searchOffset);
            const headerMatch = /REQUEST>>Length=(\d+)-> ?/.exec(searchable);
            if (!headerMatch) {
                const remaining = searchable.length > 512
                    ? searchable.slice(-512)
                    : searchable;
                return { complete, remaining };
            }
            const headerStart = searchOffset + headerMatch.index;
            const payloadStart = headerStart + headerMatch[0].length;
            const expectedLength = Number(headerMatch[1]);
            if (expectedLength !== tmi_parser_1.TMI_BODY_LENGTH) {
                throw new Error(`Invalid TMI trace length: expected ${tmi_parser_1.TMI_BODY_LENGTH}, ` +
                    `received ${expectedLength}`);
            }
            let cursor = payloadStart;
            let payload = '';
            while (cursor < buffer.length && payload.length < expectedLength) {
                const character = buffer[cursor++];
                if (character !== '\r' && character !== '\n') {
                    payload += character;
                }
            }
            if (payload.length < expectedLength) {
                return {
                    complete,
                    remaining: buffer.slice(headerStart),
                };
            }
            complete.push(payload);
            searchOffset = cursor;
        }
        return {
            complete,
            remaining: buffer.slice(searchOffset),
        };
    }
    async dispatch(socket, raw) {
        try {
            const length = Buffer.byteLength(raw, 'latin1');
            if (length !== tmi_parser_1.TMI_BODY_LENGTH) {
                throw new Error(`Invalid TMI body length: expected ${tmi_parser_1.TMI_BODY_LENGTH}, received ${length}`);
            }
            const parsed = await this.tmiService.processRawString(raw);
            this.safeWrite(socket, `${JSON.stringify(parsed)}\n`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to process message: ${message}`);
            this.safeWrite(socket, `${JSON.stringify({ error: message })}\n`);
        }
    }
    safeWrite(socket, data) {
        if (socket.destroyed || !socket.writable) {
            return;
        }
        try {
            socket.write(data);
        }
        catch {
        }
    }
};
exports.TcpListenerService = TcpListenerService;
exports.TcpListenerService = TcpListenerService = TcpListenerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [tmi_service_1.TmiService,
        config_1.ConfigService])
], TcpListenerService);
//# sourceMappingURL=tcp-listener.service.js.map