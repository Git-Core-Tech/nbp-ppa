// SPDX-License-Identifier: Apache-2.0

import * as net from 'net';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TmiService } from '../tmi/tmi.service';
import { TMI_BODY_LENGTH } from '../tmi/tmi-parser';

@Injectable()
export class TcpListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TcpListenerService.name);
  private server?: net.Server;
  private readonly tcpPort: number;
  private readonly tcpHost: string;

  constructor(
    private readonly tmiService: TmiService,
    private readonly configService: ConfigService,
  ) {
    this.tcpPort = Number(
      this.configService.get<string | number>('tcpPort') ??
        this.configService.get<string | number>('TCP_PORT') ??
        3004,
    );

    this.tcpHost =
      this.configService.get<string>('tcpHost') ??
      this.configService.get<string>('TCP_HOST') ??
      '0.0.0.0';

    if (!Number.isInteger(this.tcpPort) || this.tcpPort <= 0) {
      throw new Error(`Invalid TCP port: ${this.tcpPort}`);
    }
  }

  onModuleInit(): void {
    this.server = net.createServer((socket) => this.handleConnection(socket));

    this.server.listen(this.tcpPort, this.tcpHost, () => {
      this.logger.log(
        `TCP server listening on ${this.tcpHost}:${this.tcpPort} ` +
          `[Fractals trace -> ${TMI_BODY_LENGTH}-byte TMI body]`,
      );
    });

    this.server.on('error', (error) => {
      this.logger.error(`TCP server error: ${error.message}`);
    });
  }

  onModuleDestroy(): void {
    this.server?.close(() => {
      this.logger.log('TCP server closed');
    });
  }

  private handleConnection(socket: net.Socket): void {
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    this.logger.log(`Client connected: ${remote}`);

    let traceBuffer = '';
    let processingQueue: Promise<void> = Promise.resolve();

    socket.on('data', (chunk: Buffer) => {
      this.logger.log(`Received ${chunk.length} bytes from ${remote}: ${chunk}`);

      traceBuffer += chunk.toString('latin1');

      const messages = this.drainTraceMessages(traceBuffer);
      traceBuffer = messages.remaining;

      this.logger.log(
        `Complete TMI messages: ${messages.complete.length}, ` +
          `remaining trace bytes: ${Buffer.byteLength(traceBuffer, 'latin1')}`,
      );

      // Keep processing and responses ordered for each socket.
      for (const message of messages.complete) {
        processingQueue = processingQueue
          .then(() => this.dispatch(socket, message))
          .catch((error: unknown) => {
            const text = error instanceof Error ? error.message : String(error);
            this.logger.error(`Processing queue failed [${remote}]: ${text}`);
          });
      }
    });

    socket.on('end', () => {
      if (traceBuffer.length > 0) {
        this.logger.debug(
          `Ignoring ${Buffer.byteLength(traceBuffer, 'latin1')} ` +
            'remaining non-payload trace bytes',
        );
        traceBuffer = '';
      }

      this.logger.log(`Client disconnected: ${remote}`);
    });

    socket.on('error', (error) => {
      this.logger.error(`Socket error [${remote}]: ${error.message}`);
    });
  }

  private drainTraceMessages(
    buffer: string,
  ): { complete: string[]; remaining: string } {
    const complete: string[] = [];
    let searchOffset = 0;

    while (searchOffset < buffer.length) {
      const searchable = buffer.slice(searchOffset);
      const headerMatch = /REQUEST>>Length=(\d+)-> ?/.exec(searchable);

      if (!headerMatch) {
        // Preserve a short tail because the header may be split across chunks.
        const remaining = searchable.length > 512
          ? searchable.slice(-512)
          : searchable;
        return { complete, remaining };
      }

      const headerStart = searchOffset + headerMatch.index;
      const payloadStart = headerStart + headerMatch[0].length;
      const expectedLength = Number(headerMatch[1]);

      if (expectedLength !== TMI_BODY_LENGTH) {
        throw new Error(
          `Invalid TMI trace length: expected ${TMI_BODY_LENGTH}, ` +
            `received ${expectedLength}`,
        );
      }

      let cursor = payloadStart;
      let payload = '';

      while (cursor < buffer.length && payload.length < expectedLength) {
        const character = buffer[cursor++];

        // CR/LF are visual wrapping in the copied Fractals trace.
        if (character !== '\r' && character !== '\n') {
          payload += character;
        }
      }

      if (payload.length < expectedLength) {
        return {
          complete,
          remaining: buffer.slice(headerStart),
        };
      }

      complete.push(payload);
      searchOffset = cursor;
    }

    return {
      complete,
      remaining: buffer.slice(searchOffset),
    };
  }

  private async dispatch(socket: net.Socket, raw: string): Promise<void> {
    try {
      const length = Buffer.byteLength(raw, 'latin1');
      if (length !== TMI_BODY_LENGTH) {
        throw new Error(
          `Invalid TMI body length: expected ${TMI_BODY_LENGTH}, received ${length}`,
        );
      }

      const parsed = await this.tmiService.processRawString(raw);

      // Step 1 response: JSON is only for confirming all parsed fields.
      // Replace this in the response-message step with the fixed-width TMI reply.
      this.safeWrite(socket, `${JSON.stringify(parsed)}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to process message: ${message}`);
      this.safeWrite(socket, `${JSON.stringify({ error: message })}\n`);
    }
  }

  private safeWrite(socket: net.Socket, data: string): void {
    if (socket.destroyed || !socket.writable) {
      return;
    }

    try {
      socket.write(data);
    } catch {
      // The peer disconnected between the writable check and socket.write().
    }
  }
}
