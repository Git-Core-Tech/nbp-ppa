import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TmiService } from '../tmi/tmi.service';
export declare class TcpListenerService implements OnModuleInit, OnModuleDestroy {
    private readonly tmiService;
    private readonly configService;
    private readonly logger;
    private server?;
    private readonly tcpPort;
    private readonly tcpHost;
    constructor(tmiService: TmiService, configService: ConfigService);
    onModuleInit(): void;
    onModuleDestroy(): void;
    private handleConnection;
    private drainTraceMessages;
    private dispatch;
    private safeWrite;
}
