// SPDX-License-Identifier: Apache-2.0

import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { TmiTransactionDto } from './dto/tmi-transaction.dto';
import { TmiService, TransactionResult } from './tmi.service';

@Controller()
export class TmiController {
  constructor(private readonly tmiService: TmiService) { }

  @Get()
  healthCheck(): { status: string } {
    return { status: 'UP' };
  }

  @Get('/health')
  health(): { status: string } {
    return { status: 'UP' };
  }

  /**
   * Submit a single TMI1910 transaction.
   * Maps NBP/PPA fields to ISO 20022 and forwards all 4 message types to Tazama TMS.
   *
   * POST /v1/transaction
   */
  @Post('/v1/transaction')
  @HttpCode(200)
  async submitTransaction(@Body() payload: string): Promise<TransactionResult> {
    return this.tmiService.processTransaction(payload);
  }
}
