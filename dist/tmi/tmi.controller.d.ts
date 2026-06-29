import { TmiService, TransactionResult } from './tmi.service';
export declare class TmiController {
    private readonly tmiService;
    constructor(tmiService: TmiService);
    healthCheck(): {
        status: string;
    };
    health(): {
        status: string;
    };
    submitTransaction(payload: string): Promise<TransactionResult>;
}
