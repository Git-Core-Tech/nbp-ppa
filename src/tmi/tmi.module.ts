// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IsoModule } from '../iso/iso.module';
import { TmiService } from './tmi.service';

@Module({
  imports: [ConfigModule, IsoModule],
  providers: [TmiService],
  exports: [TmiService],
})
export class TmiModule {}
