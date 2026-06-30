// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IsoService } from './iso.service';

@Module({
  imports: [ConfigModule],
  providers: [IsoService],
  exports: [IsoService],
})
export class IsoModule {}
