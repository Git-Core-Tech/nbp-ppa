// SPDX-License-Identifier: Apache-2.0

import { IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * TMI1910 AUTH_REQUEST transaction payload (NBP/PPA format).
 * Required fields are the minimum needed to generate all 4 ISO 20022 payloads.
 * All other TMI1910 fields are accepted as optional pass-through.
 */
export class TmiTransactionDto {
  // ── Timing ────────────────────────────────────────────────────────────────

  @IsString()
  remote_time_sent: string; // "20230525001149" YYYYMMDDHHMMSS

  // ── Transaction IDs ───────────────────────────────────────────────────────

  @IsString()
  trs_txnid_1: string; // "2775565321" - unique transaction ID

  @IsString()
  @IsOptional()
  trs_txnid_2?: string;

  @IsString()
  @IsOptional()
  trs_msg_type?: string; // "0200"

  // ── Banks / Agents ────────────────────────────────────────────────────────

  @IsString()
  org_code: string; // "HBL" - originating bank (maps to SENDER_AGENT_SPID)

  @IsString()
  secondary_org_code: string; // "HBL" - destination bank (maps to RECEIVER_AGENT_SPID)

  // ── Accounts ──────────────────────────────────────────────────────────────

  @IsString()
  trs_account: string; // Sender PAN / account number

  @IsString()
  destination_account: string; // Receiver IBAN / account number

  // ── Amount & Currency ─────────────────────────────────────────────────────

  @IsNumber()
  @Type(() => Number)
  trs_amount_pan: number; // 2500.00 (instructed amount in card currency)

  @IsString()
  trs_curr_pan: string; // "PKR" (ISO 4217 alpha-3)

  @IsString()
  @IsOptional()
  trs_curr_local?: string; // "586" (numeric ISO 4217 - local settlement currency)

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  trs_amount_local?: number;

  @IsString()
  @IsOptional()
  trs_curr_orig?: string;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  trs_amount_orig?: number;

  // ── Merchant / Reporting ──────────────────────────────────────────────────

  @IsString()
  @IsOptional()
  trs_mer_code?: string; // "3" - maps to REPORTING_CODE

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  trs_mcc?: number; // 6011 - MCC code (fallback for reporting code)

  @IsString()
  @IsOptional()
  trs_mer_name?: string;

  @IsString()
  @IsOptional()
  trs_mer_city?: string;

  @IsString()
  @IsOptional()
  trs_mer_country?: string;

  // ── Optional name overrides ───────────────────────────────────────────────
  // TMI1910 does not carry customer names; these allow callers to enrich the
  // payload when the name is known (e.g. from a CIF lookup). Falls back to
  // org_code / secondary_org_code when absent.

  @IsString()
  @IsOptional()
  sender_name?: string;

  @IsString()
  @IsOptional()
  receiver_name?: string;

  // ── Additional TMI1910 fields (informational / pass-through) ──────────────

  @IsString()
  @IsOptional()
  interface_version?: string; // "0371"

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  record_type?: number; // 20 = AUTH_REQUEST

  @IsString()
  @IsOptional()
  trs_txn_date?: string;

  @IsString()
  @IsOptional()
  trs_mer_txn_date?: string;

  @IsString()
  @IsOptional()
  trs_pos_cond_code?: string;

  @IsString()
  @IsOptional()
  trs_entry_mode?: string;

  @IsString()
  @IsOptional()
  trs_reply_code?: string;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  service_code?: number;

  @IsString()
  @IsOptional()
  iban_country_code?: string;

  @IsString()
  @IsOptional()
  iban_check_digits?: string;

  @IsString()
  @IsOptional()
  iban_bank_id?: string;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  card_brand?: number;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  domestic_transaction_type?: number;
}
