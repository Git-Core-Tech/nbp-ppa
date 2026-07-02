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

const MLI_HEADER_LENGTH = 2;
const TMI_FRAME_LENGTH = MLI_HEADER_LENGTH + TMI_BODY_LENGTH;

@Injectable()
export class TcpListenerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TcpListenerService.name);

  private server?: net.Server;
  private readonly sockets = new Set<net.Socket>();

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

    if (
      !Number.isInteger(this.tcpPort) ||
      this.tcpPort < 1 ||
      this.tcpPort > 65535
    ) {
      throw new Error(`Invalid TCP port: ${this.tcpPort}`);
    }
  }

  onModuleInit(): void {
    this.server = net.createServer((socket) => {
      this.handleConnection(socket);
    });

    this.server.on('error', (error: Error) => {
      this.logger.error(
        `TCP server error: ${error.message}`,
        error.stack,
      );
    });

    this.server.listen(this.tcpPort, this.tcpHost, () => {
      this.logger.log(
        `TCP server listening on ${this.tcpHost}:${this.tcpPort} ` +
          `[${MLI_HEADER_LENGTH}-byte MLI + ` +
          `${TMI_BODY_LENGTH}-byte TMI body = ` +
          `${TMI_FRAME_LENGTH}-byte frame]`,
      );
    });
  }

  onModuleDestroy(): void {
    for (const socket of this.sockets) {
      socket.destroy();
    }

    this.sockets.clear();

    if (!this.server) {
      return;
    }

    this.server.close((error?: Error) => {
      if (error) {
        this.logger.error(
          `Failed to close TCP server: ${error.message}`,
        );
        return;
      }

      this.logger.log('TCP server closed');
    });
  }

  private handleConnection(socket: net.Socket): void {
    const remote = this.getRemoteAddress(socket);

    this.sockets.add(socket);

    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30_000);

    this.logger.log(`Client connected: ${remote}`);

    let receiveBuffer = Buffer.alloc(0);
    let processingQueue: Promise<void> = Promise.resolve();
    let disconnectLogged = false;

    const logDisconnected = (): void => {
      if (disconnectLogged) {
        return;
      }

      disconnectLogged = true;
      this.logger.log(`Client disconnected: ${remote}`);
    };

    socket.on('data', (chunk: Buffer) => {
      try {
        this.logger.debug(
          `Received ${chunk.length} bytes from ${remote}; ` +
            `hexPreview=${chunk.subarray(0, 32).toString('hex')}; ` +
            `textPreview=${JSON.stringify(
              chunk.subarray(0, 100).toString('latin1'),
            )}`,
        );

        receiveBuffer = Buffer.concat([
          receiveBuffer,
          chunk,
        ]);

        let completeFrameCount = 0;

        /*
         * TCP is a stream. A frame can arrive:
         *
         * 1. In one TCP chunk
         * 2. Split across multiple TCP chunks
         * 3. Together with additional frames
         *
         * The first two bytes contain the total frame length
         * as an unsigned big-endian integer.
         *
         * For this TMI message:
         *
         *   05 57 = 1367
         */
        while (receiveBuffer.length >= MLI_HEADER_LENGTH) {
          const declaredFrameLength =
            receiveBuffer.readUInt16BE(0);

          if (declaredFrameLength !== TMI_FRAME_LENGTH) {
            const headerPreview = receiveBuffer
              .subarray(
                0,
                Math.min(receiveBuffer.length, 16),
              )
              .toString('hex');

            throw new Error(
              `Invalid MLI length: expected ` +
                `${TMI_FRAME_LENGTH}, received ` +
                `${declaredFrameLength}; ` +
                `header=${headerPreview}`,
            );
          }

          if (receiveBuffer.length < declaredFrameLength) {
            // Wait for the rest of the TCP frame.
            break;
          }

          /*
           * Copy the complete frame before advancing the
           * receive buffer.
           */
          const frame = Buffer.from(
            receiveBuffer.subarray(
              0,
              declaredFrameLength,
            ),
          );

          receiveBuffer = receiveBuffer.subarray(
            declaredFrameLength,
          );

          completeFrameCount += 1;

          processingQueue = processingQueue
            .then(() =>
              this.dispatch(socket, frame, remote),
            )
            .catch((error: unknown) => {
              const message =
                error instanceof Error
                  ? error.message
                  : String(error);

              this.logger.error(
                `Processing queue failed ` +
                  `[${remote}]: ${message}`,
              );
            });
        }

        this.logger.log(
          `Complete TMI frames: ${completeFrameCount}, ` +
            `buffered bytes: ${receiveBuffer.length}`,
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        this.logger.error(
          `Invalid TCP data [${remote}]: ${message}`,
        );

        this.safeWrite(
          socket,
          `${JSON.stringify({ error: message })}\n`,
          remote,
        );

        socket.destroy();
      }
    });

    socket.on('end', () => {
      if (receiveBuffer.length > 0) {
        if (receiveBuffer.length >= MLI_HEADER_LENGTH) {
          const declaredFrameLength =
            receiveBuffer.readUInt16BE(0);

          this.logger.warn(
            `Client ended connection with ` +
              `${receiveBuffer.length} buffered bytes; ` +
              `MLI declares ${declaredFrameLength} bytes; ` +
              `${Math.max(
                0,
                declaredFrameLength -
                  receiveBuffer.length,
              )} bytes missing [${remote}]`,
          );
        } else {
          this.logger.warn(
            `Client ended connection with ` +
              `${receiveBuffer.length} incomplete MLI byte ` +
              `[${remote}]`,
          );
        }
      }

      logDisconnected();
    });

    socket.on('close', () => {
      this.sockets.delete(socket);
      receiveBuffer = Buffer.alloc(0);
      logDisconnected();
    });

    socket.on('error', (error: Error) => {
      this.logger.error(
        `Socket error [${remote}]: ${error.message}`,
      );
    });
  }

  private async dispatch(
    socket: net.Socket,
    frame: Buffer,
    remote: string,
  ): Promise<void> {
    try {
      /*
       * Validate the complete 1367-byte frame.
       */
      if (frame.length !== TMI_FRAME_LENGTH) {
        throw new Error(
          `Invalid TMI frame length: expected ` +
            `${TMI_FRAME_LENGTH}, received ` +
            `${frame.length}`,
        );
      }

      const declaredFrameLength = frame.readUInt16BE(0);

      if (declaredFrameLength !== frame.length) {
        throw new Error(
          `MLI mismatch: header declares ` +
            `${declaredFrameLength} bytes, but frame ` +
            `contains ${frame.length} bytes`,
        );
      }

      /*
       * IMPORTANT:
       *
       * Remove the first two MLI bytes before passing the
       * data to TmiService.
       *
       * frame:
       *   bytes 0-1    = MLI header
       *   bytes 2-1366 = 1365-byte TMI body
       */
      const bodyBuffer = frame.subarray(
        MLI_HEADER_LENGTH,
      );

      if (bodyBuffer.length !== TMI_BODY_LENGTH) {
        throw new Error(
          `Invalid TMI body length after removing MLI: ` +
            `expected ${TMI_BODY_LENGTH}, received ` +
            `${bodyBuffer.length}`,
        );
      }

      const rawBody = bodyBuffer.toString('latin1');

      /*
       * Do not use trim(), trimStart(), or trimEnd().
       * Spaces at the end of fixed-width fields are part
       * of the TMI message.
       */
      const result =
        await this.tmiService.processRawString(rawBody);

      this.logger.log(
        `Successfully processed ` +
          `${frame.length}-byte frame ` +
          `(${bodyBuffer.length}-byte TMI body) ` +
          `from ${remote}`,
      );

      /*
       * Temporary test response.
       *
       * If the remote payment system expects a fixed-width
       * TMI response, replace this JSON response with the
       * actual response-message builder.
       */
      this.safeWrite(
        socket,
        `${JSON.stringify(result)}\n`,
        remote,
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      this.logger.error(
        `Failed to process TMI frame ` +
          `[${remote}]: ${message}`,
      );

      this.safeWrite(
        socket,
        `${JSON.stringify({ error: message })}\n`,
        remote,
      );
    }
  }

  private safeWrite(
    socket: net.Socket,
    data: string | Buffer,
    remote: string,
  ): void {
    if (socket.destroyed || !socket.writable) {
      this.logger.warn(
        `Response not sent because socket is not ` +
          `writable [${remote}]`,
      );

      return;
    }

    socket.write(data, (error?: Error) => {
      if (error) {
        this.logger.error(
          `Failed to write response ` +
            `[${remote}]: ${error.message}`,
        );
      }
    });
  }

  private getRemoteAddress(
    socket: net.Socket,
  ): string {
    const address =
      socket.remoteAddress ?? 'unknown';

    const port =
      socket.remotePort ?? 'unknown';

    return `${address}:${port}`;
  }
}