// SPDX-License-Identifier: Apache-2.0

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TmiService {
  private readonly logger = new Logger(TmiService.name);

  constructor(private readonly configService: ConfigService) {}

  async processRawString(raw: string): Promise<string> {
    this.logger.log(`Received (${raw.length} bytes): ${raw}`);
    return raw;
  }
}

// ── Commented out ─────────────────────────────────────────────────────────────
//
// import axios from 'axios';
// import { Pool } from 'pg';
// import { Fields, getPacs002FromColumns, getPacs008FromPain001,
//          getPain001FromColumns, getPain013FromPain001 } from '../iso/message-generation';
// import { parseTmi1910, ParsedTmi } from '../tcp/tmi-parser';
//
// export interface TransactionResult {
//   transactionId: string; pain001: boolean; pain013: boolean;
//   pacs008: boolean; pacs002: boolean; evaluation: unknown | null;
// }
//
// Full pipeline (parse → ISO payloads → TMS → eval DB poll) is in git history.
// Restore when ready to connect to a live Tazama instance.
