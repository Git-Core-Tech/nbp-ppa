// SPDX-License-Identifier: Apache-2.0

import { Module } from '@nestjs/common';
import { TmiModule } from '../tmi/tmi.module';
import { TcpListenerService } from './tcp-listener.service';

@Module({
  imports: [TmiModule],
  providers: [TcpListenerService],
})
export class TcpModule {}
