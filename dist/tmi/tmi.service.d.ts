import { ConfigService } from '@nestjs/config';
export interface TransactionResult {
    transactionId: string;
    pain001: boolean;
    pain013: boolean;
    pacs008: boolean;
    pacs002: boolean;
}
export declare class TmiService {
    private readonly configService;
    private readonly logger;
    private readonly tmsEndpoint;
    private readonly tenantId;
    private readonly timezoneOffset;
    private readonly authHeader;
    constructor(configService: ConfigService);
    processTransaction(payload: string): Promise<any>;
    private buildColumns;
    private parseTimestamp;
    private postToTms;
}
