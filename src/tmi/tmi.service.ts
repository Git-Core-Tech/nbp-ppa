// SPDX-License-Identifier: Apache-2.0

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  Fields,
  getPacs002FromColumns,
  getPacs008FromPain001,
  getPain001FromColumns,
  getPain013FromPain001,
} from '../iso/message-generation';
import { parseTmi1910, ParsedTmi, TMI_MESSAGE_LENGTH } from '../tcp/tmi-parser';

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

  async processRawString(raw: string): Promise<string> {
    this.logger.log(`Complete message length: ${raw.length} bytes (expected ${TMI_MESSAGE_LENGTH})`);

    if (raw.length !== TMI_MESSAGE_LENGTH) {
      this.logger.warn(`Length mismatch — skipping`);
      return JSON.stringify({ error: `Expected ${TMI_MESSAGE_LENGTH} bytes, got ${raw.length}` });
    }

    const parsed = parseTmi1910(raw);
    this.logger.log(`Parsed TMI: txnid=${parsed.trs_txnid_1} amount=${parsed.trs_amount_pan} ${parsed.trs_curr_pan} sender=${parsed.trs_account} receiver=${parsed.destination_account}`);

    const result = await this.processTransaction(parsed);
    return JSON.stringify(result);
  }

  async processTransaction(parsed: ParsedTmi): Promise<TransactionResult> {
    const columns = this.buildColumns(parsed);
    const transactionId = columns[Fields.MESSAGE_ID];

    this.logger.log(`Processing transaction ${transactionId}`);

    const pain001 = getPain001FromColumns(columns, this.tenantId);
    const pain013 = getPain013FromPain001(pain001);
    const pacs008 = getPacs008FromPain001(pain001);
    const pacs002 = getPacs002FromColumns(columns);

    this.logger.log(`Generated pain.001 msgId=${pain001.CstmrCdtTrfInitn.GrpHdr.MsgId}`);
    this.logger.log(`Generated pain.013 msgId=${pain013.CdtrPmtActvtnReq.GrpHdr.MsgId}`);

    // TMS schema rejects TenantId in pacs.008 body — strip before posting
    const { TenantId: _t, ...pacs008Body } = pacs008 as any;

    // TMS must ingest pacs.008 before it can match the corresponding pacs.002 —
    // sending them concurrently races that dependency and pacs.002 gets a 500.
    const pacs008Result = await this.postToTms('pacs.008.001.10', pacs008Body);
    const pacs002Result = await this.postToTms('pacs.002.001.12', pacs002);

    const result: TransactionResult = {
      transactionId,
      pain001: true,   // generated — no TMS endpoint for pain.001 in this deployment
      pain013: true,   // generated — no TMS endpoint for pain.013 in this deployment
      pacs008: pacs008Result,
      pacs002: pacs002Result,
    };

    if (pacs008Result && pacs002Result) {
      this.logger.log(`Transaction ${transactionId} submitted successfully`);
    } else {
      this.logger.warn(`Transaction ${transactionId} partial failure: ${JSON.stringify(result)}`);
    }

    return result;
  }

  private buildColumns(p: ParsedTmi): string[] {
    const columns: string[] = new Array(14).fill('');
    columns[Fields.PROCESSING_DATE_TIME] = this.parseTimestamp(p.remote_time_sent);
    columns[Fields.MESSAGE_ID]            = p.trs_txnid_1;
    columns[Fields.TRANSACTION_TYPE]      = 'TRA';
    columns[Fields.PAYMENT_CURRENCY_CODE] = p.trs_curr_pan;
    columns[Fields.TOTAL_PAYMENT_AMOUNT]  = Number(p.trs_amount_pan).toFixed(2);
    columns[Fields.SENDER_ID]             = p.trs_account;
    columns[Fields.SENDER_NAME]           = p.org_code;
    columns[Fields.RECEIVER_ID]           = p.destination_account;
    columns[Fields.RECEIVER_NAME]         = p.correspondent_name || p.secondary_org_code;
    columns[Fields.SENDER_AGENT_SPID]     = p.org_code;
    columns[Fields.RECEIVER_AGENT_SPID]   = p.secondary_org_code;
    columns[Fields.SENDER_ACCOUNT]        = p.trs_account;
    columns[Fields.RECEIVER_ACCOUNT]      = p.destination_account;
    columns[Fields.REPORTING_CODE]        = p.trs_mer_code || p.trs_mcc || '';
    return columns;
  }

  // "20230525001149" (YYYYMMDDHHMMSS) → ISO 8601 with configured timezone offset
  private parseTimestamp(ts: string): string {
    const padded = ts.padStart(14, '0');
    const yyyy = padded.slice(0, 4);
    const MM   = padded.slice(4, 6);
    const dd   = padded.slice(6, 8);
    const HH   = padded.slice(8, 10);
    const mm   = padded.slice(10, 12);
    const ss   = padded.slice(12, 14);
    return `${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}${this.timezoneOffset}`;
  }

  private async postToTms(txType: string, payload: unknown): Promise<boolean> {
    const url = `${this.tmsEndpoint}/v1/evaluate/iso20022/${txType}`;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.authHeader) headers['Authorization'] = this.authHeader;
      const response = await axios.post(url, payload, { headers });
      this.logger.log(`TMS ${txType} → HTTP ${response.status}`);
      return response.status === 200;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to POST ${txType} to TMS: ${msg}`);
      return false;
    }
  }
}
