// SPDX-License-Identifier: Apache-2.0

import { config } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

config();

async function bootstrap(): Promise<void> {
  const app =
    await NestFactory.create<NestExpressApplication>(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  app.useBodyParser('text');

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port', 3003);

  await app.listen(port);
  console.log(`nbp-ppa listening on port ${port}`);
}

bootstrap().catch((err: unknown) => {
  console.error('Failed to start:', err);
  process.exit(1);
});