// SPDX-License-Identifier: Apache-2.0

import { config } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

config();

async function bootstrap(): Promise<void> {
  // No HTTP server — pure TCP socket only
  await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error', 'debug'] });
}

bootstrap().catch((err: unknown) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
