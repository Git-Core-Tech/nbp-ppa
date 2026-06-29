// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { TmiModule } from './tmi/tmi.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      load: [configuration],
      cache: true,
    }),
    TmiModule,
  ],
})
export class AppModule {}
