// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { TmiController } from './tmi.controller';
import { TmiService } from './tmi.service';

@Module({
  controllers: [TmiController],
  providers: [TmiService],
})
export class TmiModule {}
