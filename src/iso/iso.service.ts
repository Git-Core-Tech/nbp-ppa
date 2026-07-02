// SPDX-License-Identifier: Apache-2.0

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import {
  Fields,
  getPacs002FromColumns,
  getPacs008FromPain001,
  getPain001FromColumns,
  getPain013FromPain001,
} from './message-generation';
import { ParsedTmi } from '../tmi/tmi-parser';

export interface TmsSubmissionResult {
  transactionType: 'pacs.008.001.10' | 'pacs.002.001.12';
  success: boolean;
  status?: number;
  error?: string;
}

export interface TransactionResult {
  transactionId: string;
  generated: {
    pain001: true;
    pain013: true;
    pacs008: true;
    pacs002: true;
  };
  submitted: {
    pacs008: TmsSubmissionResult;
    pacs002: TmsSubmissionResult;
  };
}

@Injectable()
export class IsoService {
  private readonly logger = new Logger(IsoService.name);
  private readonly tenantId: string;
  private readonly timezoneOffset: string;
  private readonly http: AxiosInstance;
  private readonly authHeader?: string;

  constructor(private readonly configService: ConfigService) {
    const tmsEndpoint = this.getString(
      'tmsEndpoint',
      'TMS_ENDPOINT',
      'http://localhost:5000',
    ).replace(/\/+$/, '');

    this.tenantId = this.getString('tenantId', 'TENANT_ID', 'DEFAULT');
    this.timezoneOffset = this.getString(
      'timezoneOffset',
      'TIMEZONE_OFFSET',
      '+05:00',
    );

    if (!/^[+-]\d{2}:\d{2}$/.test(this.timezoneOffset)) {
      throw new Error(
        `Invalid TIMEZONE_OFFSET "${this.timezoneOffset}". Expected a value such as +05:00.`,
      );
    }

    const authenticated = this.getBoolean(
      'authenticated',
      'AUTHENTICATED',
      false,
    );
    const authToken = this.getString('authToken', 'AUTH_TOKEN', '');
    this.authHeader = authenticated && authToken
      ? `Bearer ${authToken}`
      : undefined;

    const timeoutMs = this.getNumber(
      'tmsRequestTimeoutMs',
      'TMS_REQUEST_TIMEOUT_MS',
      10_000,
    );

    this.http = axios.create({
      baseURL: tmsEndpoint,
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async processTransaction(parsed: ParsedTmi): Promise<TransactionResult> {
    const columns = this.buildColumns(parsed);
    const transactionId = columns[Fields.MESSAGE_ID];

    this.logger.log(`Generating ISO 20022 messages for ${transactionId}`);

    const pain001 = getPain001FromColumns(columns, this.tenantId);
    const pain013 = getPain013FromPain001(pain001);
    const pacs008 = getPacs008FromPain001(pain001);
    const pacs002 = getPacs002FromColumns(columns);

    this.logger.log('Generated pain.001', pain001);
    this.logger.log('Generated pain.013', pain013);
    this.logger.log('Generated pacs.008', pacs008);
    this.logger.log('Generated pacs.002', pacs002);

    this.logger.debug(
      `Generated ISO message IDs: ` +
      `pain.001=${pain001.CstmrCdtTrfInitn.GrpHdr.MsgId}, ` +
      `pain.013=${pain013.CdtrPmtActvtnReq.GrpHdr.MsgId}, ` +
      `pacs.008=${pacs008.FIToFICstmrCdtTrf.GrpHdr.MsgId}, ` +
      `pacs.002=${pacs002.FIToFIPmtSts.GrpHdr.MsgId}`,
    );

    // This TMS deployment rejects TenantId inside the pacs.008 body.
    // Keep TenantId on the generated object, but omit it from the HTTP payload.
    const { TenantId: _tenantId, ...pacs008Body } = pacs008;

    // Submit in order. pacs.002 is a status message associated with the payment,
    // so sending it after pacs.008 avoids avoidable ordering races.
    const pacs008Result = await this.postToTms(
      'pacs.008.001.10',
      pacs008Body,
    );

    const pacs002Result = pacs008Result.success
      ? await this.postToTms('pacs.002.001.12', pacs002)
      : {
        transactionType: 'pacs.002.001.12' as const,
        success: false,
        error: 'Skipped because pacs.008 submission failed',
      };

    const result: TransactionResult = {
      transactionId,
      generated: {
        pain001: true,
        pain013: true,
        pacs008: true,
        pacs002: true,
      },
      submitted: {
        pacs008: pacs008Result,
        pacs002: pacs002Result,
      },
    };

    if (pacs008Result.success && pacs002Result.success) {
      this.logger.log(`Transaction ${transactionId} submitted successfully`);
    } else {
      this.logger.warn(
        `Transaction ${transactionId} was not fully submitted: ${JSON.stringify(result.submitted)}`,
      );
    }

    return result;
  }

  private buildColumns(p: ParsedTmi): string[] {
    const columns = new Array<string>(Fields.REPORTING_CODE + 1).fill('');

    const transactionId = this.requireValue(
      p.trs_txnid_1 || p.trs_txnid_2,
      'transaction ID',
    );

    const senderAccount = this.requireValue(
      p.trs_account,
      'sender account',
    );

    /*
     * In the current TMI1910 feed, destination_account is blank and the
     * receiver IBAN is supplied in custom_text_50_1.
     */
    const receiverAccount = this.requireValue(
      this.firstValue(
        p.destination_account,
        p.custom_text_50_1,
      ),
      'receiver account',
    );

    const amount = this.firstValue(
      p.trs_amount_orig,
      p.trs_amount_pan,
      p.trs_amount_local,
    );
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) {
      throw new Error(`Invalid transaction amount "${amount}"`);
    }

    const currency = this.normalizeCurrency(
      this.firstValue(
        p.trs_curr_orig,
        p.trs_curr_pan,
        p.trs_curr_local,
      ),
    );

    const senderAgent = this.requireValue(
      p.org_code,
      'sender agent identifier',
    );

    /*
     * custom_text_10_1 contains the receiver bank code in the current feed
     * (for example, ABL). For a Pakistani IBAN, extractIbanBankId() provides
     * the four-character bank identifier (for example, ABPA).
     */
    const receiverAgent = this.firstValue(
      p.custom_text_10_1,
      p.iban_bank_id,
      this.extractIbanBankId(receiverAccount),
      p.secondary_org_code,
    );

    if (!receiverAgent) {
      throw new Error('Receiver agent identifier is missing');
    }

    // TMI1910 does not provide reliable customer-person names in this sample.
    // The organisation fields are used as controlled fallbacks until a proper
    // customer/account lookup is connected.
    const senderName = p.org_code || 'UNKNOWN SENDER';
    const receiverName = p.correspondent_name || p.secondary_org_code || 'UNKNOWN RECEIVER';

    if (!p.correspondent_name) {
      this.logger.warn(
        `No receiver customer name in TMI ${transactionId}; using "${receiverName}" as a fallback`,
      );
    }

    columns[Fields.PROCESSING_DATE_TIME] = this.parseTimestamp(
      p.remote_time_sent,
    );
    columns[Fields.MESSAGE_ID] = transactionId;
    columns[Fields.TRANSACTION_TYPE] = 'TRA';
    columns[Fields.PAYMENT_CURRENCY_CODE] = currency;
    columns[Fields.TOTAL_PAYMENT_AMOUNT] = numericAmount.toFixed(2);
    columns[Fields.SENDER_ID] = senderAccount;
    columns[Fields.SENDER_NAME] = senderName;
    columns[Fields.RECEIVER_ID] = receiverAccount;
    columns[Fields.RECEIVER_NAME] = receiverName;
    columns[Fields.SENDER_AGENT_SPID] = senderAgent;
    columns[Fields.RECEIVER_AGENT_SPID] = receiverAgent;
    columns[Fields.SENDER_ACCOUNT] = senderAccount;
    columns[Fields.RECEIVER_ACCOUNT] = receiverAccount;

    // trs_mer_code is the merchant/channel number ("3" in the sample), not a
    // regulatory reporting code. MCC is a safer value until an explicit
    // reporting-code mapping is supplied.
    columns[Fields.REPORTING_CODE] = this.firstValue(
      p.trs_mcc,
      p.processing_code_transaction_type,
    );

    return columns;
  }

  private parseTimestamp(timestamp: string): string {
    if (!/^\d{14}$/.test(timestamp)) {
      throw new Error(
        `Invalid remote_time_sent "${timestamp}". Expected YYYYMMDDHHMMSS.`,
      );
    }

    const yyyy = timestamp.slice(0, 4);
    const month = timestamp.slice(4, 6);
    const day = timestamp.slice(6, 8);
    const hour = timestamp.slice(8, 10);
    const minute = timestamp.slice(10, 12);
    const second = timestamp.slice(12, 14);

    const iso = `${yyyy}-${month}-${day}T${hour}:${minute}:${second}${this.timezoneOffset}`;
    const parsed = new Date(iso);

    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid TMI transaction timestamp "${timestamp}"`);
    }

    return iso;
  }

  private async postToTms(
    transactionType: TmsSubmissionResult['transactionType'],
    payload: unknown,
  ): Promise<TmsSubmissionResult> {
    try {
      const headers: Record<string, string> = {};
      if (this.authHeader) {
        headers.Authorization = this.authHeader;
      }

      const response = await this.http.post(
        `/v1/evaluate/iso20022/${transactionType}`,
        payload,
        { headers },
      );

      const success = response.status >= 200 && response.status < 300;
      this.logger.log(
        `TMS ${transactionType} -> HTTP ${response.status}`,
      );

      return {
        transactionType,
        success,
        status: response.status,
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      const responseData = axiosError.response?.data;
      const detail = responseData
        ? `${axiosError.message}; response=${this.safeJson(responseData)}`
        : axiosError.message || String(error);

      this.logger.error(
        `Failed to POST ${transactionType} to TMS` +
        `${status ? ` (HTTP ${status})` : ''}: ${detail}`,
      );

      return {
        transactionType,
        success: false,
        status,
        error: detail,
      };
    }
  }

  private extractIbanBankId(account: string): string {
    const compact = account.replace(/\s+/g, '').toUpperCase();
    return /^PK\d{2}[A-Z0-9]{4}/.test(compact)
      ? compact.slice(4, 8)
      : '';
  }

  private normalizeCurrency(currency: string): string {
    const normalized = currency.trim().toUpperCase();
    if (normalized === '586') {
      return 'PKR';
    }
    return normalized;
  }

  private firstValue(...values: Array<string | undefined>): string {
    return values.find((value) => value?.trim())?.trim() ?? '';
  }

  private requireValue(
    value: string | undefined | null,
    fieldName: string,
  ): string {
    const normalized = value?.trim() ?? '';

    if (!normalized) {
      throw new Error(`Required ${fieldName} is missing`);
    }

    return normalized;
  }

  private safeJson(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private getString(
    configKey: string,
    environmentKey: string,
    fallback: string,
  ): string {
    const value =
      this.configService.get<string>(configKey) ??
      this.configService.get<string>(environmentKey) ??
      fallback;
    return String(value).trim();
  }

  private getBoolean(
    configKey: string,
    environmentKey: string,
    fallback: boolean,
  ): boolean {
    const value =
      this.configService.get<boolean | string>(configKey) ??
      this.configService.get<boolean | string>(environmentKey);

    if (value === undefined || value === null || value === '') {
      return fallback;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    return value.toLowerCase() === 'true';
  }

  private getNumber(
    configKey: string,
    environmentKey: string,
    fallback: number,
  ): number {
    const value =
      this.configService.get<number | string>(configKey) ??
      this.configService.get<number | string>(environmentKey) ??
      fallback;
    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`Invalid ${environmentKey}: ${value}`);
    }
    return parsed;
  }
}
