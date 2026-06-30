// SPDX-License-Identifier: Apache-2.0
/**
 * TMI1910 AUTH_REQUEST parser.
 *
 * Header interpretation used here:
 *   0371 | 20 | 00YYYYMMDDHHMMSS
 *
 * Wire forms supported:
 *  - 1365-byte printable body beginning with "0371"
 *  - 1367-byte frame: 2-byte big-endian MLI + 1365-byte body
 *  - Fractals trace text through TmiTraceDecoder
 */

export interface FieldDef {
  pos: number;
  len: number;
  type: 'varchar' | 'number' | 'number_2dp' | 'textdate' | 'binary';
}

export const TMI_FIELDS = {
  interface_version:           { pos: 0,    len: 4,  type: 'varchar'    },
  // Common-header layout used by the field specification:
  //   interface version: 4 bytes ("0371")
  //   record type:       2 bytes ("20")
  //   remote time sent: 16 bytes ("00" + YYYYMMDDHHMMSS)
  //
  // The bytes on the wire therefore begin:
  //   0371 | 20 | 00 | 20230525001149
  //
  // Some spreadsheets combine "20" + "00" and describe it as a four-byte
  // record type "2000". Both descriptions consume the same 18 header bytes,
  // so every field after remote_time_sent keeps the same offset.
  record_type:                 { pos: 4,    len: 2,  type: 'number'     },
  remote_time_sent:            { pos: 6,    len: 16, type: 'textdate'   },
  remote_time_received:        { pos: 22,   len: 16, type: 'number'     },
  local_time_received:         { pos: 38,   len: 16, type: 'number'     },
  local_time_sent:             { pos: 54,   len: 16, type: 'number'     },
  trs_txnid_1:                 { pos: 70,   len: 20, type: 'varchar'    },
  trs_txnid_2:                 { pos: 90,   len: 20, type: 'varchar'    },
  trs_msg_type:                { pos: 110,  len: 4,  type: 'varchar'    },
  org_code:                    { pos: 114,  len: 10, type: 'varchar'    },
  secondary_org_code:          { pos: 124,  len: 10, type: 'varchar'    },
  trs_account:                 { pos: 134,  len: 48, type: 'varchar'    },
  trs_bin:                     { pos: 182,  len: 20, type: 'varchar'    },
  trs_txn_date:                { pos: 202,  len: 19, type: 'textdate'   },
  trs_mer_txn_date:            { pos: 221,  len: 18, type: 'textdate'   },
  trs_amount_pan:              { pos: 239,  len: 17, type: 'number_2dp' }, // stored as integer*100
  trs_curr_pan:                { pos: 256,  len: 3,  type: 'varchar'    },
  trs_amount_local:            { pos: 259,  len: 17, type: 'number_2dp' },
  trs_curr_local:              { pos: 276,  len: 3,  type: 'varchar'    },
  trs_amount_orig:             { pos: 279,  len: 17, type: 'number_2dp' },
  trs_curr_orig:               { pos: 296,  len: 3,  type: 'varchar'    },
  trs_mer_code:                { pos: 299,  len: 20, type: 'varchar'    },
  trs_mcc:                     { pos: 319,  len: 5,  type: 'number'     },
  trs_mer_name:                { pos: 324,  len: 50, type: 'varchar'    },
  trs_mer_city:                { pos: 374,  len: 50, type: 'varchar'    },
  trs_mer_country:             { pos: 424,  len: 3,  type: 'varchar'    },
  trs_request_type:            { pos: 427,  len: 6,  type: 'varchar'    },
  trs_reply_code:              { pos: 433,  len: 6,  type: 'varchar'    },
  trs_auth_code:               { pos: 439,  len: 20, type: 'varchar'    },
  trs_pos_cond_code:           { pos: 459,  len: 2,  type: 'varchar'    },
  trs_entry_mode:              { pos: 461,  len: 2,  type: 'varchar'    },
  trs_term_pin_capability:     { pos: 463,  len: 2,  type: 'varchar'    },
  trs_auth_phase:              { pos: 465,  len: 4,  type: 'varchar'    },
  trs_decline_phase:           { pos: 469,  len: 4,  type: 'varchar'    },
  trs_track1_present:          { pos: 473,  len: 1,  type: 'number'     },
  trs_track2_present:          { pos: 474,  len: 1,  type: 'number'     },
  trs_cvv2_4dbc_check:         { pos: 475,  len: 1,  type: 'number'     },
  trs_card_expiry:             { pos: 476,  len: 4,  type: 'varchar'    },
  trs_term_type:               { pos: 480,  len: 1,  type: 'varchar'    },
  trs_term_chip_capability:    { pos: 481,  len: 1,  type: 'varchar'    },
  trs_chip_cond_code:          { pos: 482,  len: 1,  type: 'varchar'    },
  trs_f60_4_reserved:          { pos: 483,  len: 1,  type: 'varchar'    },
  trs_mer_group:               { pos: 484,  len: 2,  type: 'varchar'    },
  trs_txn_ind:                 { pos: 486,  len: 1,  type: 'varchar'    },
  trs_auth_reliability:        { pos: 487,  len: 1,  type: 'varchar'    },
  trs_ecomm_ind:               { pos: 488,  len: 2,  type: 'varchar'    },
  mc_pos_term_att_ind:         { pos: 490,  len: 1,  type: 'varchar'    },
  mc_pos_61_2_reserved:        { pos: 491,  len: 1,  type: 'varchar'    },
  mc_pos_term_loc_ind:         { pos: 492,  len: 1,  type: 'varchar'    },
  mc_pos_ch_pres_ind:          { pos: 493,  len: 1,  type: 'varchar'    },
  mc_pos_card_pres_ind:        { pos: 494,  len: 1,  type: 'varchar'    },
  mc_pos_card_capture_cap:     { pos: 495,  len: 1,  type: 'varchar'    },
  mc_pos_txn_stat_ind:         { pos: 496,  len: 1,  type: 'varchar'    },
  mc_pos_txn_sec_ind:          { pos: 497,  len: 1,  type: 'varchar'    },
  mc_pos_61_9_reserved:        { pos: 498,  len: 1,  type: 'varchar'    },
  mc_cat_level_ind:            { pos: 499,  len: 1,  type: 'varchar'    },
  mc_pos_term_inp_cap:         { pos: 500,  len: 1,  type: 'varchar'    },
  mc_pos_auth_life_cycle:      { pos: 501,  len: 2,  type: 'number'     },
  mc_pos_country:              { pos: 503,  len: 3,  type: 'varchar'    },
  mc_pos_postal_code:          { pos: 506,  len: 10, type: 'varchar'    },
  mc_ecomm_sec_encrypted:      { pos: 516,  len: 1,  type: 'varchar'    },
  mc_ecomm_sec_cryptogram:     { pos: 517,  len: 1,  type: 'varchar'    },
  mc_ecomm_sec_ucaf:           { pos: 518,  len: 1,  type: 'varchar'    },
  trs_open_to_buy:             { pos: 519,  len: 17, type: 'number_2dp' },
  trs_pan_conf_bal:            { pos: 536,  len: 17, type: 'number_2dp' },
  trs_pan_pend_txns:           { pos: 553,  len: 17, type: 'varchar'    },
  trs_product:                 { pos: 570,  len: 20, type: 'varchar'    },
  trs_credit_limit:            { pos: 590,  len: 17, type: 'varchar'    },
  trs_pan_status:              { pos: 607,  len: 20, type: 'varchar'    },
  trs_term_id:                 { pos: 627,  len: 8,  type: 'varchar'    },
  trs_cust_status:             { pos: 635,  len: 5,  type: 'varchar'    },
  trs_pan_test_txn:            { pos: 640,  len: 1,  type: 'number'     },
  trs_credit_limit_temp:       { pos: 641,  len: 17, type: 'number_2dp' },
  trs_credit_limit_temp_exp:   { pos: 658,  len: 10, type: 'textdate'   },
  trs_parent_account:          { pos: 668,  len: 48, type: 'varchar'    },
  trs_parent_account_type:     { pos: 716,  len: 20, type: 'varchar'    },
  trs_mer_region_code:         { pos: 736,  len: 20, type: 'varchar'    },
  trs_business_date:           { pos: 756,  len: 10, type: 'textdate'   },
  cavv_ucaf_ind:               { pos: 766,  len: 1,  type: 'varchar'    },
  security_block:              { pos: 767,  len: 1,  type: 'varchar'    },
  security_reason:             { pos: 768,  len: 1,  type: 'varchar'    },
  collection_block:            { pos: 769,  len: 1,  type: 'varchar'    },
  collection_reason:           { pos: 770,  len: 1,  type: 'varchar'    },
  other_block:                 { pos: 771,  len: 1,  type: 'varchar'    },
  other_reason:                { pos: 772,  len: 1,  type: 'varchar'    },
  notification_reason_code:    { pos: 773,  len: 1,  type: 'varchar'    },
  fractals_response_override:  { pos: 774,  len: 1,  type: 'varchar'    },
  auth_rule_override:          { pos: 775,  len: 1,  type: 'varchar'    },
  emv_cryptogram_check_status: { pos: 776,  len: 1,  type: 'varchar'    },
  emv_chip_enabled_card:       { pos: 777,  len: 1,  type: 'varchar'    },
  emv_contactless_enabled_card:{ pos: 778,  len: 1,  type: 'varchar'    },
  emv_prefer_offline_verify:   { pos: 779,  len: 1,  type: 'varchar'    },
  atc_rule_code:               { pos: 780,  len: 10, type: 'varchar'    },
  atc_rule_code_1:             { pos: 790,  len: 10, type: 'varchar'    },
  action_response_code_1:      { pos: 800,  len: 10, type: 'varchar'    },
  atc_rule_code_2:             { pos: 810,  len: 10, type: 'varchar'    },
  action_response_code_2:      { pos: 820,  len: 10, type: 'varchar'    },
  atc_rule_code_3:             { pos: 830,  len: 10, type: 'varchar'    },
  action_response_code_3:      { pos: 840,  len: 10, type: 'varchar'    },
  atc_rule_code_4:             { pos: 850,  len: 10, type: 'varchar'    },
  action_response_code_4:      { pos: 860,  len: 10, type: 'varchar'    },
  product_category:            { pos: 870,  len: 10, type: 'varchar'    },
  txn_category_code:           { pos: 880,  len: 1,  type: 'varchar'    },
  card_verify_method:          { pos: 881,  len: 1,  type: 'varchar'    },
  adv_reason_code:             { pos: 882,  len: 3,  type: 'varchar'    },
  adv_detail_code:             { pos: 885,  len: 4,  type: 'varchar'    },
  risk_condition_code:         { pos: 889,  len: 6,  type: 'varchar'    },
  real_time_scoring:           { pos: 895,  len: 3,  type: 'varchar'    },
  domestic_country:            { pos: 898,  len: 3,  type: 'varchar'    },
  acquirer_country:            { pos: 901,  len: 3,  type: 'varchar'    },
  destination_sort_code:       { pos: 904,  len: 6,  type: 'varchar'    },
  destination_account:         { pos: 910,  len: 48, type: 'varchar'    },
  service_code:                { pos: 958,  len: 3,  type: 'number'     },
  state_code:                  { pos: 961,  len: 3,  type: 'varchar'    },
  custom_amount_1:             { pos: 964,  len: 17, type: 'number_2dp' },
  custom_flag_1:               { pos: 981,  len: 1,  type: 'varchar'    },
  custom_text_50_1:            { pos: 982,  len: 50, type: 'varchar'    },
  custom_text_10_1:            { pos: 1032, len: 10, type: 'varchar'    },
  custom_integer_1:            { pos: 1042, len: 3,  type: 'number'     },
  custom_datetime_1:           { pos: 1045, len: 19, type: 'textdate'   },
  custom_amount_2:             { pos: 1064, len: 17, type: 'number_2dp' },
  custom_flag_2:               { pos: 1081, len: 1,  type: 'varchar'    },
  custom_text_50_2:            { pos: 1082, len: 50, type: 'varchar'    },
  custom_text_10_2:            { pos: 1132, len: 10, type: 'varchar'    },
  custom_integer_2:            { pos: 1142, len: 3,  type: 'number'     },
  custom_datetime_2:           { pos: 1145, len: 19, type: 'textdate'   },
  custom_amount_3:             { pos: 1164, len: 17, type: 'number_2dp' },
  custom_flag_3:               { pos: 1181, len: 1,  type: 'varchar'    },
  custom_text_50_3:            { pos: 1182, len: 50, type: 'varchar'    },
  custom_text_10_3:            { pos: 1232, len: 10, type: 'varchar'    },
  custom_integer_3:            { pos: 1242, len: 3,  type: 'number'     },
  custom_datetime_3:           { pos: 1245, len: 19, type: 'textdate'   },
  iban_country_code:           { pos: 1264, len: 2,  type: 'varchar'    },
  iban_check_digits:           { pos: 1266, len: 2,  type: 'varchar'    },
  iban_bank_id:                { pos: 1268, len: 4,  type: 'varchar'    },
  correspondent_name:          { pos: 1272, len: 50, type: 'varchar'    },
  correspondent_ref:           { pos: 1322, len: 30, type: 'varchar'    },
  card_brand:                  { pos: 1352, len: 2,  type: 'number'     },
  issuing_bank:                { pos: 1354, len: 2,  type: 'number'     },
  domestic_transaction_type:   { pos: 1356, len: 3,  type: 'number'     },
  chip_card_indicator:         { pos: 1359, len: 2,  type: 'varchar'    },
  card_origin:                 { pos: 1361, len: 1,  type: 'number'     },
  auth_conclusion_code:        { pos: 1362, len: 3,  type: 'number'     },
  // trs_de55 BINARY 0 at pos 1365 (variable length — ignored)
} as const satisfies Record<string, FieldDef>;


export const TMI_BODY_LENGTH = 1365;
export const TMI_MLI_LENGTH = 2;
export const TMI_WIRE_LENGTH = TMI_BODY_LENGTH + TMI_MLI_LENGTH;
export const TMI_INTERFACE_VERSION = '0371';
export const TMI_AUTH_REQUEST_RECORD_TYPE = '20';

export interface ParseTmiOptions {
  /** Trace logs use dots to display space padding. Never enable this for raw production bytes. */
  dotIsPadding?: boolean;
  validate?: boolean;
}

export type TmiFieldName = keyof typeof TMI_FIELDS;

export type ParsedTmi = Record<TmiFieldName, string> & {
  processing_code_transaction_type: string;
  processing_code_from_account: string;
  processing_code_to_account: string;
};

export function parseTmi1910(
  input: string | Buffer,
  options: ParseTmiOptions = {},
): ParsedTmi {
  const body = extractTmiBody(input);
  const raw = body.toString('latin1');

  if (options.validate !== false) {
    validateTmiRequestBody(raw);
  }

  const fields = {} as Record<TmiFieldName, string>;

  for (const [name, def] of Object.entries(TMI_FIELDS) as Array<[TmiFieldName, FieldDef]>) {
    const slice = raw.slice(def.pos, def.pos + def.len);
    if (slice.length !== def.len) {
      throw new Error(
        `Field ${name} is truncated: expected ${def.len}, received ${slice.length}`,
      );
    }

    fields[name] = extractValue(
      slice,
      def.type,
      options.dotIsPadding === true,
    );
  }

  // The protocol allocates 16 bytes for remote_time_sent. In the supplied
  // messages the first two bytes are zero padding and the remaining 14 bytes
  // are YYYYMMDDHHMMSS. Return the useful 14-digit timestamp to callers.
  fields.remote_time_sent = normalizeRemoteTimeSent(fields.remote_time_sent);

  const processingCode = splitProcessingCode(fields.trs_request_type);

  return {
    ...fields,
    processing_code_transaction_type: processingCode.transactionType,
    processing_code_from_account: processingCode.fromAccount,
    processing_code_to_account: processingCode.toAccount,
  };
}

/** Return the 1365-byte body from either a body-only or MLI-framed input. */
export function extractTmiBody(input: string | Buffer): Buffer {
  const value = Buffer.isBuffer(input)
    ? input
    : Buffer.from(input, 'latin1');

  if (
    value.length === TMI_BODY_LENGTH &&
    value.subarray(0, 4).toString('ascii') === TMI_INTERFACE_VERSION
  ) {
    return value;
  }

  if (
    value.length === TMI_WIRE_LENGTH &&
    value.subarray(2, 6).toString('ascii') === TMI_INTERFACE_VERSION
  ) {
    const declared = value.readUInt16BE(0);
    // Some Fractals documents describe the MLI as inclusive, while traces label
    // only the 1365-byte body. Accept both declarations, but never ignore bytes.
    if (declared !== TMI_BODY_LENGTH && declared !== TMI_WIRE_LENGTH) {
      throw new Error(
        `Invalid TMI MLI ${declared}; expected ${TMI_BODY_LENGTH} or ${TMI_WIRE_LENGTH}`,
      );
    }
    return value.subarray(TMI_MLI_LENGTH);
  }

  throw new Error(
    `Invalid TMI input length/header: received ${value.length} bytes; ` +
      `expected ${TMI_BODY_LENGTH}-byte body or ${TMI_WIRE_LENGTH}-byte MLI frame`,
  );
}

export function validateTmiRequestBody(raw: string): void {
  if (Buffer.byteLength(raw, 'latin1') !== TMI_BODY_LENGTH) {
    throw new Error(
      `Invalid AUTH_REQUEST length: expected ${TMI_BODY_LENGTH}, received ${Buffer.byteLength(raw, 'latin1')}`,
    );
  }

  const interfaceVersion = raw.slice(0, 4);
  if (interfaceVersion !== TMI_INTERFACE_VERSION) {
    throw new Error(
      `Unsupported interface version ${JSON.stringify(interfaceVersion)}; expected ${TMI_INTERFACE_VERSION}`,
    );
  }

  const recordType = raw.slice(4, 6);
  if (recordType !== TMI_AUTH_REQUEST_RECORD_TYPE) {
    throw new Error(
      `Invalid AUTH_REQUEST record type ${JSON.stringify(recordType)}; expected ${TMI_AUTH_REQUEST_RECORD_TYPE}`,
    );
  }

  const remoteTimeSent = raw.slice(6, 22);
  if (!/^\d{16}$/.test(remoteTimeSent)) {
    throw new Error(
      `Invalid remote_time_sent ${JSON.stringify(remoteTimeSent)}; expected 16 digits`,
    );
  }

  if (!/^00\d{14}$/.test(remoteTimeSent)) {
    throw new Error(
      `Invalid remote_time_sent ${JSON.stringify(remoteTimeSent)}; ` +
        `expected "00" followed by YYYYMMDDHHMMSS`,
    );
  }
}

export function splitProcessingCode(value: string): {
  transactionType: string;
  fromAccount: string;
  toAccount: string;
} {
  const normalized = value.padEnd(6, ' ').slice(0, 6);
  return {
    transactionType: normalized.slice(0, 2).trim(),
    fromAccount: normalized.slice(2, 4).trim(),
    toAccount: normalized.slice(4, 6).trim(),
  };
}

function extractValue(
  raw: string,
  type: FieldDef['type'],
  dotIsPadding: boolean,
): string {
  switch (type) {
    case 'varchar':
      return normalizeVarchar(raw, dotIsPadding);

    case 'textdate':
      // Dots inside date fields are real separators in this TMI format.
      // Only leading/trailing trace padding is removed.
      return trimPadding(raw, dotIsPadding);

    case 'number': {
      // Codes such as 000, 0200 and 6011 must keep leading zeroes.
      return trimPadding(raw, dotIsPadding);
    }

    case 'number_2dp':
      return minorUnitsToDecimal(trimPadding(raw, dotIsPadding));

    case 'binary':
    default:
      return raw;
  }
}

function normalizeVarchar(value: string, dotIsPadding: boolean): string {
  if (!dotIsPadding) {
    return value.trim();
  }

  /*
   * Fractals DEBUG traces render space characters as dots. In trace mode,
   * convert them back for text fields. This changes "Level.0" to "Level 0".
   *
   * Never enable dotIsPadding for real raw socket data because a literal dot
   * in production data must remain a dot.
   */
  return value.replace(/\./g, ' ').trim();
}

function trimPadding(value: string, dotIsPadding: boolean): string {
  return dotIsPadding
    ? value.replace(/^[ .]+|[ .]+$/g, '')
    : value.trim();
}

function normalizeRemoteTimeSent(value: string): string {
  if (/^00\d{14}$/.test(value)) {
    return value.slice(2);
  }

  return value;
}

function minorUnitsToDecimal(value: string): string {
  if (value === '') return '0.00';
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid fixed-point amount ${JSON.stringify(value)}`);
  }

  const padded = value.padStart(3, '0');
  const whole = padded.slice(0, -2).replace(/^0+(?=\d)/, '') || '0';
  const fraction = padded.slice(-2);
  return `${whole}.${fraction}`;
}

/**
 * Streaming decoder for copied Fractals trace output such as:
 *   ... REQUEST>>Length=1365-> 0371...\r\n...
 *
 * CR/LF wrapping is removed. Other bytes are preserved exactly.
 */
export class TmiTraceDecoder {
  private buffer = '';
  private readonly maxBufferBytes: number;

  constructor(maxBufferBytes = 1024 * 1024) {
    this.maxBufferBytes = maxBufferBytes;
  }

  push(chunk: Buffer | string): string[] {
    this.buffer += Buffer.isBuffer(chunk) ? chunk.toString('latin1') : chunk;
    if (Buffer.byteLength(this.buffer, 'latin1') > this.maxBufferBytes) {
      throw new Error(`Trace buffer exceeded ${this.maxBufferBytes} bytes`);
    }
    return this.drain();
  }

  finish(): { messages: string[]; ignored: string } {
    const messages = this.drain();
    const incomplete = /REQUEST>>Length=(\d+)-> ?/.exec(this.buffer);
    if (incomplete) {
      throw new Error(
        `Connection ended with incomplete trace payload declared as ${incomplete[1]} bytes`,
      );
    }

    const ignored = this.buffer;
    this.buffer = '';
    return { messages, ignored };
  }

  private drain(): string[] {
    const messages: string[] = [];

    while (true) {
      const match = /REQUEST>>Length=(\d+)-> ?/.exec(this.buffer);
      if (!match || match.index === undefined) {
        // Retain enough tail for a header split across TCP chunks.
        if (this.buffer.length > 512) {
          this.buffer = this.buffer.slice(-512);
        }
        break;
      }

      const expectedLength = Number(match[1]);
      if (!Number.isInteger(expectedLength) || expectedLength <= 0) {
        throw new Error(`Invalid trace payload length ${JSON.stringify(match[1])}`);
      }
      if (expectedLength !== TMI_BODY_LENGTH) {
        throw new Error(
          `Unsupported trace payload length ${expectedLength}; expected ${TMI_BODY_LENGTH}`,
        );
      }

      const payloadStart = match.index + match[0].length;
      let cursor = payloadStart;
      let payload = '';

      while (cursor < this.buffer.length && payload.length < expectedLength) {
        const character = this.buffer[cursor++];
        if (character !== '\r' && character !== '\n') {
          payload += character;
        }
      }

      if (payload.length < expectedLength) {
        // Discard unrelated prefix, but retain the complete header and partial payload.
        this.buffer = this.buffer.slice(match.index);
        break;
      }

      messages.push(payload);
      this.buffer = this.buffer.slice(cursor);
    }

    return messages;
  }
}
