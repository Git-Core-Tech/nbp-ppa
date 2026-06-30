// SPDX-License-Identifier: Apache-2.0

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsoService, TransactionResult } from '../iso/iso.service';
import {
  ParsedTmi,
  parseTmi1910,
  TMI_BODY_LENGTH,
} from './tmi-parser';

@Injectable()
export class TmiService {
  private readonly logger = new Logger(TmiService.name);
  private readonly dotIsPadding: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly isoService: IsoService,
  ) {
    const inputMode =
      this.configService.get<string>('tmiInputMode') ??
      this.configService.get<string>('TMI_INPUT_MODE') ??
      'trace';

    this.dotIsPadding = inputMode.toLowerCase() === 'trace';
  }

  async processRawString(raw: string): Promise<TransactionResult> {
    const byteLength = Buffer.byteLength(raw, 'latin1');

    this.logger.log(
      `Received TMI body (${byteLength} bytes; expected ${TMI_BODY_LENGTH}); Message: ${raw}`);

    if (byteLength !== TMI_BODY_LENGTH) {
      throw new Error(
        `Invalid TMI body length: expected ${TMI_BODY_LENGTH}, ` +
        `received ${byteLength}`,
      );
    }

    const parsed = parseTmi1910(raw, {
      dotIsPadding: this.dotIsPadding,
      validate: true,
    });

    this.logParsedTransaction(parsed);

    return this.isoService.processTransaction(parsed);
  }

  private logParsedTransaction(parsed: ParsedTmi): void {
    this.logger.log(
      `Parsed transaction: ` +
      `recordType=${parsed.record_type}, ` +
      `transactionId=${parsed.trs_txnid_1 || parsed.trs_txnid_2}, ` +
      `mti=${parsed.trs_msg_type}, ` +
      `processingCode=${parsed.trs_request_type}, ` +
      `amount=${parsed.trs_amount_orig || parsed.trs_amount_pan} ` +
      `${parsed.trs_curr_orig || parsed.trs_curr_pan}`,
    );

    this.logger.debug(
      `Parsed TMI fields:\n${JSON.stringify(parsed, null, 2)}`,
    );
  }
}