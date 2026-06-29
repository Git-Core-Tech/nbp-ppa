import { ConfigService } from '@nestjs/config';
import { TmiTransactionDto } from './dto/tmi-transaction.dto';
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
    processRawString(raw: string): Promise<TransactionResult>;
    processTransaction(dto: TmiTransactionDto): Promise<TransactionResult>;
    processRawBody(raw: string): Promise<TransactionResult>;
    private process;
    private buildColumnsFromParsed;
    private buildColumnsFromDto;
    private parseTimestamp;
    private postToTms;
}
