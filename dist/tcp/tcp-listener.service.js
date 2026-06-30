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
let TcpListenerService = TcpListenerService_1 = class TcpListenerService {
    constructor(tmiService, configService) {
        this.tmiService = tmiService;
        this.configService = configService;
        this.logger = new common_1.Logger(TcpListenerService_1.name);
        this.tcpPort = this.configService.get('tcpPort', 3004);
        this.tcpHost = this.configService.get('tcpHost', '0.0.0.0');
        this.msgLength = this.configService.get('msgLength', 0);
    }
    onModuleInit() {
        this.server = net.createServer((socket) => this.handleConnection(socket));
        this.server.listen(this.tcpPort, this.tcpHost, () => {
            const mode = this.msgLength > 0
                ? `fixed-length (${this.msgLength} bytes)`
                : 'newline-delimited';
            this.logger.log(`TCP server listening on ${this.tcpHost}:${this.tcpPort} [${mode}]`);
        });
        this.server.on('error', (err) => {
            this.logger.error(`TCP server error: ${err.message}`);
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
        let buffer = '';
        socket.on('data', async (chunk) => {
            this.logger.log(`Received ${chunk.length} bytes from ${remote}: ${JSON.stringify(chunk.toString('latin1'))}`);
            buffer += chunk.toString('latin1');
            const messages = this.drainMessages(buffer);
            buffer = messages.remaining;
            this.logger.log(`Complete messages: ${messages.complete.length}, buffered bytes: ${buffer.length}`);
            for (const msg of messages.complete) {
                await this.dispatch(socket, msg);
            }
        });
        socket.on('end', () => {
            if (buffer.length > 0) {
                this.dispatch(socket, buffer).catch(() => { });
                buffer = '';
            }
            this.logger.log(`Client disconnected: ${remote}`);
        });
        socket.on('error', (err) => {
            this.logger.error(`Socket error [${remote}]: ${err.message}`);
        });
    }
    drainMessages(buffer) {
        const complete = [];
        if (this.msgLength > 0) {
            let offset = 0;
            while (offset + this.msgLength <= buffer.length) {
                complete.push(buffer.substring(offset, offset + this.msgLength));
                offset += this.msgLength;
            }
            return { complete, remaining: buffer.substring(offset) };
        }
        if (buffer.includes('0371')) {
            let offset = 0;
            while (offset < buffer.length) {
                const markerPos = buffer.indexOf('0371', offset);
                if (markerPos === -1)
                    break;
                if (markerPos + 1365 > buffer.length) {
                    return { complete, remaining: buffer.substring(markerPos) };
                }
                complete.push(buffer.substring(markerPos, markerPos + 1365));
                offset = markerPos + 1365;
            }
            return { complete, remaining: buffer.substring(offset) };
        }
        const lines = buffer.split('\n');
        const remaining = lines.pop() ?? '';
        complete.push(...lines.filter((l) => l.length > 0));
        return { complete, remaining };
    }
    safeWrite(socket, data) {
        if (!socket.destroyed && socket.writable) {
            try {
                socket.write(data);
            }
            catch {
            }
        }
    }
    async dispatch(socket, raw) {
        try {
            const result = await this.tmiService.processRawString(raw.trimEnd());
            this.safeWrite(socket, JSON.stringify(result) + '\n');
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`Failed to process message: ${msg}`);
            this.safeWrite(socket, JSON.stringify({ error: msg }) + '\n');
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