// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { TmiService } from './tmi.service';

@Module({
  providers: [TmiService],
  exports: [TmiService],
})
export class TmiModule {}
