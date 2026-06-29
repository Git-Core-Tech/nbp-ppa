// SPDX-License-Identifier: Apache-2.0

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TmiService {
  private readonly logger = new Logger(TmiService.name);

  constructor(private readonly configService: ConfigService) {}

  async processRawString(raw: string): Promise<string> {
    this.logger.log(`Received: ${raw}`);
    return raw;
  }
}

// ── Commented out until payload processing is needed ──────────────────────────
//
// import axios from 'axios';
// import {
//   Fields,
//   getPacs002FromColumns,
//   getPacs008FromPain001,
//   getPain001FromColumns,
//   getPain013FromPain001,
// } from '../iso/message-generation';
// import { parseTmi1910, ParsedTmi } from '../tcp/tmi-parser';
//
// export interface TransactionResult {
//   transactionId: string;
//   pain001: boolean;
//   pain013: boolean;
//   pacs008: boolean;
//   pacs002: boolean;
// }
//
// private readonly tmsEndpoint: string;
// private readonly tenantId: string;
// private readonly timezoneOffset: string;
// private readonly authHeader: string | undefined;
//
//   constructor(private readonly configService: ConfigService) {
//     this.tmsEndpoint = this.configService.get<string>('tmsEndpoint', 'http://localhost:5000');
//     this.tenantId = this.configService.get<string>('tenantId', 'DEFAULT');
//     this.timezoneOffset = this.configService.get<string>('timezoneOffset', '+05:00');
//     const authenticated = this.configService.get<boolean>('authenticated', false);
//     const authToken = this.configService.get<string>('authToken', '');
//     this.authHeader = authenticated && authToken ? `Bearer ${authToken}` : undefined;
//   }
//
//   async processRawString(raw: string): Promise<TransactionResult> {
//     const parsed = parseTmi1910(raw);
//     return this.process(this.buildColumns(parsed));
//   }
//
//   private async process(columns: string[]): Promise<TransactionResult> {
//     const transactionId = columns[Fields.MESSAGE_ID];
//     const pain001 = getPain001FromColumns(columns, this.tenantId);
//     const pain013 = getPain013FromPain001(pain001);
//     const pacs008 = getPacs008FromPain001(pain001);
//     const pacs002 = getPacs002FromColumns(columns);
//     const { TenantId: _t, ...pacs008Body } = pacs008 as any;
//     const [pacs008Result, pacs002Result] = await Promise.all([
//       this.postToTms('pacs.008.001.10', pacs008Body),
//       this.postToTms('pacs.002.001.12', pacs002),
//     ]);
//     return { transactionId, pain001: true, pain013: true, pacs008: pacs008Result, pacs002: pacs002Result };
//   }
//
//   private buildColumns(p: ParsedTmi): string[] {
//     const columns: string[] = new Array(14).fill('');
//     columns[Fields.PROCESSING_DATE_TIME] = this.parseTimestamp(p.remote_time_sent);
//     columns[Fields.MESSAGE_ID]           = p.trs_txnid_1;
//     columns[Fields.TRANSACTION_TYPE]     = 'TRA';
//     columns[Fields.PAYMENT_CURRENCY_CODE]= p.trs_curr_pan;
//     columns[Fields.TOTAL_PAYMENT_AMOUNT] = p.trs_amount_pan;
//     columns[Fields.SENDER_ID]            = p.trs_account;
//     columns[Fields.SENDER_NAME]          = p.org_code;
//     columns[Fields.RECEIVER_ID]          = p.destination_account;
//     columns[Fields.RECEIVER_NAME]        = p.secondary_org_code;
//     columns[Fields.SENDER_AGENT_SPID]    = p.org_code;
//     columns[Fields.RECEIVER_AGENT_SPID]  = p.secondary_org_code;
//     columns[Fields.SENDER_ACCOUNT]       = p.trs_account;
//     columns[Fields.RECEIVER_ACCOUNT]     = p.destination_account;
//     columns[Fields.REPORTING_CODE]       = p.trs_mer_code || p.trs_mcc;
//     return columns;
//   }
//
//   private parseTimestamp(ts: string): string {
//     const s = ts.padStart(14, '0');
//     return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12,14)}${this.timezoneOffset}`;
//   }
//
//   private async postToTms(txType: string, payload: unknown): Promise<boolean> {
//     const url = `${this.tmsEndpoint}/v1/evaluate/iso20022/${txType}`;
//     try {
//       const headers = this.authHeader ? { Authorization: this.authHeader } : undefined;
//       const response = await axios.post(url, payload, { headers });
//       return response.status === 200;
//     } catch (err) {
//       const msg = err instanceof Error ? err.message : String(err);
//       this.logger.error(`Failed to POST ${txType} to TMS: ${msg}`);
//       return false;
//     }
//   }
