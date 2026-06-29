// SPDX-License-Identifier: Apache-2.0

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Fields, getPacs002FromColumns, getPacs008FromPain001, getPain001FromColumns, getPain013FromPain001 } from '../iso/message-generation';
import { TmiTransactionDto } from './dto/tmi-transaction.dto';

export interface TransactionResult {
  transactionId: string;
  pain001: boolean;
  pain013: boolean;
  pacs008: boolean;
  pacs002: boolean;
}

@Injectable()
export class TmiService {
  private readonly logger = new Logger(TmiService.name);
  private readonly tmsEndpoint: string;
  private readonly tenantId: string;
  private readonly timezoneOffset: string;
  private readonly authHeader: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.tmsEndpoint = this.configService.get<string>('tmsEndpoint', 'http://localhost:5000');
    this.tenantId = this.configService.get<string>('tenantId', 'DEFAULT');
    this.timezoneOffset = this.configService.get<string>('timezoneOffset', '+05:00');

    const authenticated = this.configService.get<boolean>('authenticated', false);
    const authToken = this.configService.get<string>('authToken', '');
    this.authHeader = authenticated && authToken ? `Bearer ${authToken}` : undefined;
  }

  async processTransaction(payload: string): Promise<any> {

    console.log(payload)
    return payload;
    // const columns = this.buildColumns(dto);
    // const transactionId = columns[Fields.MESSAGE_ID];

    // this.logger.log(`Processing TMI1910 transaction ${transactionId}`);

    // const pain001 = getPain001FromColumns(columns, this.tenantId);
    // const pain013 = getPain013FromPain001(pain001);
    // const pacs008 = getPacs008FromPain001(pain001);
    // const pacs002 = getPacs002FromColumns(columns);

    // // TMS schema rejects TenantId in the body ("not required") — strip before posting.
    // const { TenantId: _t, ...pacs008Body } = pacs008 as any;
    // // pacs002 is already Omit<Pacs002,'TenantId'> — send as-is.

    // // This TMS version exposes only pacs.008 and pacs.002 endpoints.
    // // pain.001 and pain.013 are generated but not forwarded (no TMS endpoint in this deployment).
    // const [pacs008Result, pacs002Result] = await Promise.all([
    //   this.postToTms('pacs.008.001.10', pacs008Body),
    //   this.postToTms('pacs.002.001.12', pacs002),
    // ]);

    // const result: TransactionResult = {
    //   transactionId,
    //   pain001: true,  // generated, not forwarded (no TMS endpoint in this deployment)
    //   pain013: true,  // generated, not forwarded (no TMS endpoint in this deployment)
    //   pacs008: pacs008Result,
    //   pacs002: pacs002Result,
    // };

    // const allOk = pacs008Result && pacs002Result;
    // if (allOk) {
    //   this.logger.log(`Transaction ${transactionId} submitted successfully`);
    // } else {
    //   this.logger.warn(`Transaction ${transactionId} partial failure: ${JSON.stringify(result)}`);
    // }

    // return result;
  }

  private buildColumns(dto: TmiTransactionDto): string[] {
    const columns: string[] = new Array(14).fill('');
    columns[Fields.PROCESSING_DATE_TIME] = this.parseTimestamp(String(dto.remote_time_sent));
    columns[Fields.MESSAGE_ID] = dto.trs_txnid_1;
    columns[Fields.TRANSACTION_TYPE] = 'TRA';
    columns[Fields.PAYMENT_CURRENCY_CODE] = dto.trs_curr_pan;
    columns[Fields.TOTAL_PAYMENT_AMOUNT] = Number(dto.trs_amount_pan).toFixed(2);
    columns[Fields.SENDER_ID] = dto.trs_account;
    columns[Fields.SENDER_NAME] = dto.sender_name ?? dto.org_code;
    columns[Fields.RECEIVER_ID] = dto.destination_account;
    columns[Fields.RECEIVER_NAME] = dto.receiver_name ?? dto.secondary_org_code;
    columns[Fields.SENDER_AGENT_SPID] = dto.org_code;
    columns[Fields.RECEIVER_AGENT_SPID] = dto.secondary_org_code;
    columns[Fields.SENDER_ACCOUNT] = dto.trs_account;
    columns[Fields.RECEIVER_ACCOUNT] = dto.destination_account;
    columns[Fields.REPORTING_CODE] = String(dto.trs_mer_code ?? dto.trs_mcc ?? '');
    return columns;
  }

  // Convert "20230525001149" (YYYYMMDDHHMMSS) → ISO 8601 with configured timezone offset
  private parseTimestamp(ts: string): string {
    const padded = ts.padStart(14, '0');
    const yyyy = padded.slice(0, 4);
    const MM = padded.slice(4, 6);
    const dd = padded.slice(6, 8);
    const HH = padded.slice(8, 10);
    const mm = padded.slice(10, 12);
    const ss = padded.slice(12, 14);
    return `${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}${this.timezoneOffset}`;
  }

  private async postToTms(txType: string, payload: unknown): Promise<boolean> {
    const url = `${this.tmsEndpoint}/v1/evaluate/iso20022/${txType}`;
    try {
      const headers = this.authHeader ? { Authorization: this.authHeader } : undefined;
      const response = await axios.post(url, payload, { headers });
      if (response.status !== 200) {
        this.logger.error(`TMS returned ${response.status} for ${txType}`);
        return false;
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to POST ${txType} to TMS: ${msg}`);
      return false;
    }
  }
}
