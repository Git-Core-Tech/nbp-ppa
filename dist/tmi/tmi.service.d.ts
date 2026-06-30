import { ConfigService } from '@nestjs/config';
import { IsoService, TransactionResult } from '../iso/iso.service';
export declare class TmiService {
    private readonly configService;
    private readonly isoService;
    private readonly logger;
    private readonly dotIsPadding;
    constructor(configService: ConfigService, isoService: IsoService);
    processRawString(raw: string): Promise<TransactionResult>;
    private logParsedTransaction;
}
