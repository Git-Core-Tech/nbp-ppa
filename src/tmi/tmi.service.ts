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
import { parseTmi1910, ParsedTmi } from '../tcp/tmi-parser';
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

  // ── Entry points ────────────────────────────────────────────────────────────

  /** Called by the TCP listener with the raw fixed-width TMI1910 string. */
  async processRawString(raw: string): Promise<TransactionResult> {
    this.logger.debug(`Raw message received (${raw.length} bytes)`);
    const parsed = parseTmi1910(raw);
    this.logger.debug(`Parsed txnid=${parsed.trs_txnid_1} amount=${parsed.trs_amount_pan} ${parsed.trs_curr_pan}`);
    return this.process(this.buildColumnsFromParsed(parsed));
  }

  /** Called by the HTTP controller with a JSON DTO (for convenience / testing). */
  async processTransaction(dto: TmiTransactionDto): Promise<TransactionResult> {
    return this.process(this.buildColumnsFromDto(dto));
  }

  /** Called by the HTTP controller with the raw string body (text/plain). */
  async processRawBody(raw: string): Promise<TransactionResult> {
    return this.processRawString(raw);
  }

  // ── Core processing ─────────────────────────────────────────────────────────

  private async process(columns: string[]): Promise<TransactionResult> {
    const transactionId = columns[Fields.MESSAGE_ID];
    this.logger.log(`Processing transaction ${transactionId}`);

    const pain001 = getPain001FromColumns(columns, this.tenantId);
    const pain013 = getPain013FromPain001(pain001);
    const pacs008 = getPacs008FromPain001(pain001);
    const pacs002 = getPacs002FromColumns(columns);

    // TMS schema rejects TenantId in the body — strip it before posting.
    const { TenantId: _t, ...pacs008Body } = pacs008 as any;

    // This TMS deployment only exposes pacs.008 and pacs.002 endpoints.
    const [pacs008Result, pacs002Result] = await Promise.all([
      this.postToTms('pacs.008.001.10', pacs008Body),
      this.postToTms('pacs.002.001.12', pacs002),
    ]);

    const result: TransactionResult = {
      transactionId,
      pain001: true,   // generated but not forwarded (no TMS endpoint in this deployment)
      pain013: true,   // generated but not forwarded (no TMS endpoint in this deployment)
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

  // ── Column builders ─────────────────────────────────────────────────────────

  private buildColumnsFromParsed(p: ParsedTmi): string[] {
    const columns: string[] = new Array(14).fill('');
    columns[Fields.PROCESSING_DATE_TIME] = this.parseTimestamp(p.remote_time_sent);
    columns[Fields.MESSAGE_ID]           = p.trs_txnid_1;
    columns[Fields.TRANSACTION_TYPE]     = 'TRA';
    columns[Fields.PAYMENT_CURRENCY_CODE]= p.trs_curr_pan;
    columns[Fields.TOTAL_PAYMENT_AMOUNT] = p.trs_amount_pan;            // already "2500.00"
    columns[Fields.SENDER_ID]            = p.trs_account;
    columns[Fields.SENDER_NAME]          = p.org_code;
    columns[Fields.RECEIVER_ID]          = p.destination_account;
    columns[Fields.RECEIVER_NAME]        = p.secondary_org_code;
    columns[Fields.SENDER_AGENT_SPID]    = p.org_code;
    columns[Fields.RECEIVER_AGENT_SPID]  = p.secondary_org_code;
    columns[Fields.SENDER_ACCOUNT]       = p.trs_account;
    columns[Fields.RECEIVER_ACCOUNT]     = p.destination_account;
    columns[Fields.REPORTING_CODE]       = p.trs_mer_code || p.trs_mcc;
    return columns;
  }

  private buildColumnsFromDto(dto: TmiTransactionDto): string[] {
    const columns: string[] = new Array(14).fill('');
    columns[Fields.PROCESSING_DATE_TIME] = this.parseTimestamp(String(dto.remote_time_sent));
    columns[Fields.MESSAGE_ID]           = dto.trs_txnid_1;
    columns[Fields.TRANSACTION_TYPE]     = 'TRA';
    columns[Fields.PAYMENT_CURRENCY_CODE]= dto.trs_curr_pan;
    columns[Fields.TOTAL_PAYMENT_AMOUNT] = Number(dto.trs_amount_pan).toFixed(2);
    columns[Fields.SENDER_ID]            = dto.trs_account;
    columns[Fields.SENDER_NAME]          = dto.sender_name ?? dto.org_code;
    columns[Fields.RECEIVER_ID]          = dto.destination_account;
    columns[Fields.RECEIVER_NAME]        = dto.receiver_name ?? dto.secondary_org_code;
    columns[Fields.SENDER_AGENT_SPID]    = dto.org_code;
    columns[Fields.RECEIVER_AGENT_SPID]  = dto.secondary_org_code;
    columns[Fields.SENDER_ACCOUNT]       = dto.trs_account;
    columns[Fields.RECEIVER_ACCOUNT]     = dto.destination_account;
    columns[Fields.REPORTING_CODE]       = String(dto.trs_mer_code ?? dto.trs_mcc ?? '');
    return columns;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  // "20230525001149" (YYYYMMDDHHMMSS, 14 chars) → ISO 8601 with timezone offset
  private parseTimestamp(ts: string): string {
    const s = ts.padStart(14, '0');
    return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12,14)}${this.timezoneOffset}`;
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
