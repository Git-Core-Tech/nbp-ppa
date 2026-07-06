// SPDX-License-Identifier: Apache-2.0

import * as net from 'net';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TmiService } from '../tmi/tmi.service';

@Injectable()
export class TcpListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TcpListenerService.name);
  private server: net.Server;
  private readonly tcpPort: number;
  private readonly tcpHost: string;
  private readonly msgLength: number;

  constructor(
    private readonly tmiService: TmiService,
    private readonly configService: ConfigService,
  ) {
    this.tcpPort = this.configService.get<number>('tcpPort', 3004);
    this.tcpHost = this.configService.get<string>('tcpHost', '0.0.0.0');
    // MSG_LENGTH=0 means newline-delimited mode (useful for testing)
    this.msgLength = this.configService.get<number>('msgLength', 0);
  }

  onModuleInit(): void {
    this.server = net.createServer((socket) => this.handleConnection(socket));

    this.server.listen(this.tcpPort, this.tcpHost, () => {
      const mode = this.msgLength > 0
        ? `fixed-length (${this.msgLength} bytes)`
        : 'newline-delimited';
      this.logger.log(`TCP server listening on ${this.tcpHost}:${this.tcpPort} [${mode}]`);
    });

    this.server.on('error', (err) => {
      this.logger.error(`TCP server error: ${err.message}`);
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

    let buffer = '';

    socket.on('data', async (chunk: Buffer) => {
      const recvTs = new Date();
      this.logger.log(
        `Received ${chunk.length} bytes from ${remote}: ${JSON.stringify(chunk.toString('latin1'))}`,
      );

      buffer += chunk.toString('latin1');

      const messages = this.drainMessages(buffer);
      buffer = messages.remaining;

      this.logger.log(
        `Complete messages: ${messages.complete.length}, buffered bytes: ${buffer.length}`,
      );

      for (const msg of messages.complete) {
        await this.dispatch(socket, msg, recvTs);
      }
    });

    socket.on('end', () => {
      // Process any remaining buffered bytes when client closes write side
      if (buffer.length > 0) {
        this.dispatch(socket, buffer, new Date()).catch(() => { });
        buffer = '';
      }
      this.logger.log(`Client disconnected: ${remote}`);
    });

    socket.on('error', (err) => {
      this.logger.error(`Socket error [${remote}]: ${err.message}`);
    });
  }

  private drainMessages(buffer: string): { complete: string[]; remaining: string } {
    const complete: string[] = [];

    if (this.msgLength > 0) {
      // Fixed-length framing: slice MSG_LENGTH bytes at a time
      let offset = 0;
      while (offset + this.msgLength <= buffer.length) {
        complete.push(buffer.substring(offset, offset + this.msgLength));
        offset += this.msgLength;
      }
      return { complete, remaining: buffer.substring(offset) };
    }

    // TMI1910 sync-marker mode: scan for '0371' and extract 1365-byte frames.
    // Handles mixed streams where non-TMI data may precede/follow TMI messages.
    if (buffer.includes('0371')) {
      let offset = 0;
      while (offset < buffer.length) {
        const markerPos = buffer.indexOf('0371', offset);
        if (markerPos === -1) break;
        if (markerPos + 1365 > buffer.length) {
          // Incomplete frame — keep from marker onward
          return { complete, remaining: buffer.substring(markerPos) };
        }
        complete.push(buffer.substring(markerPos, markerPos + 1365));
        offset = markerPos + 1365;
      }
      return { complete, remaining: buffer.substring(offset) };
    }

    // Newline-delimited framing: split on '\n', drop a trailing '\r' from CRLF lines
    const lines = buffer.split('\n');
    const remaining = lines.pop() ?? '';
    complete.push(...lines.map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0));
    return { complete, remaining };
  }

  private safeWrite(socket: net.Socket, data: string): void {
    if (!socket.destroyed && socket.writable) {
      try {
        socket.write(data);
      } catch {
        // client disconnected before we could respond — not an error
      }
    }
  }

  private async dispatch(socket: net.Socket, raw: string, recvTs: Date): Promise<void> {
    try {
      const result = await this.tmiService.processRawString(raw, recvTs);
      this.safeWrite(socket, JSON.stringify(result) + '\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to process message: ${msg}`);
      this.safeWrite(socket, JSON.stringify({ error: msg }) + '\n');
    }
  }
}
