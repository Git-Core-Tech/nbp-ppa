import { ConfigService } from '@nestjs/config';
export declare class TmiService {
    private readonly configService;
    private readonly logger;
    constructor(configService: ConfigService);
    processRawString(raw: string): Promise<string>;
}
