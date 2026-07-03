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

const MLI_HEADER_LENGTH = 2;

type FramingMode =
  | 'auto'
  | 'mli2be-total'
  | 'mli2be-body'
  | 'trace-log'
  | 'newline';

interface ExtractedMessage {
  mode: Exclude<FramingMode, 'auto'>;
  body: Buffer;
  bytesConsumed: number;
  declaredLength?: number;
}

type ExtractionResult =
  | { status: 'need-more' }
  | { status: 'message'; message: ExtractedMessage };

@Injectable()
export class TcpListenerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TcpListenerService.name);

  private server?: net.Server;
  private readonly sockets = new Set<net.Socket>();

  private readonly tcpPort: number;
  private readonly tcpHost: string;
  private readonly framingMode: FramingMode;
  private readonly minBodyLength: number;
  private readonly maxBodyLength: number;
  private readonly maxBufferedBytes: number;
  private readonly lockAutoDetectedMode: boolean;

  constructor(
    private readonly tmiService: TmiService,
    private readonly configService: ConfigService,
  ) {
    this.tcpPort = this.readInteger(
      ['tcpPort', 'TCP_PORT'],
      3004,
      1,
      65535,
    );

    this.tcpHost =
      this.configService.get<string>('tcpHost') ??
      this.configService.get<string>('TCP_HOST') ??
      '0.0.0.0';

    this.framingMode = this.readFramingMode(
      this.configService.get<string>('tcpFramingMode') ??
        this.configService.get<string>('TCP_FRAMING_MODE') ??
        'auto',
    );

    this.minBodyLength = this.readInteger(
      ['tcpMinBodyLength', 'TCP_MIN_BODY_LENGTH'],
      1,
      0,
      65535,
    );

    this.maxBodyLength = this.readInteger(
      ['tcpMaxBodyLength', 'TCP_MAX_BODY_LENGTH'],
      65533,
      1,
      10 * 1024 * 1024,
    );

    this.maxBufferedBytes = this.readInteger(
      ['tcpMaxBufferedBytes', 'TCP_MAX_BUFFERED_BYTES'],
      Math.max(this.maxBodyLength + MLI_HEADER_LENGTH, 1024 * 1024),
      this.maxBodyLength + MLI_HEADER_LENGTH,
      100 * 1024 * 1024,
    );

    this.lockAutoDetectedMode = this.readBoolean(
      ['tcpLockAutoDetectedMode', 'TCP_LOCK_AUTO_DETECTED_MODE'],
      true,
    );

    if (this.minBodyLength > this.maxBodyLength) {
      throw new Error(
        `TCP_MIN_BODY_LENGTH (${this.minBodyLength}) cannot be greater ` +
          `than TCP_MAX_BODY_LENGTH (${this.maxBodyLength})`,
      );
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
        `TCP server listening on ${this.tcpHost}:${this.tcpPort}; ` +
          `framing=${this.framingMode}; bodyRange=` +
          `${this.minBodyLength}-${this.maxBodyLength} bytes`,
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
    let detectedMode: Exclude<FramingMode, 'auto'> | undefined;
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

        receiveBuffer = Buffer.concat([receiveBuffer, chunk]);

        if (receiveBuffer.length > this.maxBufferedBytes) {
          throw new Error(
            `Receive buffer exceeded ${this.maxBufferedBytes} bytes`,
          );
        }

        let completeMessageCount = 0;

        while (receiveBuffer.length > 0) {
          const requestedMode =
            this.framingMode === 'auto'
              ? detectedMode ?? 'auto'
              : this.framingMode;

          const result = this.tryExtractMessage(
            receiveBuffer,
            requestedMode,
          );

          if (result.status === 'need-more') {
            break;
          }

          const { message } = result;

          if (
            this.framingMode === 'auto' &&
            this.lockAutoDetectedMode &&
            !detectedMode
          ) {
            detectedMode = message.mode;
            this.logger.log(
              `Auto-detected framing mode "${detectedMode}" for ${remote}`,
            );
          }

          receiveBuffer = receiveBuffer.subarray(
            message.bytesConsumed,
          );

          completeMessageCount += 1;

          processingQueue = processingQueue
            .then(() =>
              this.dispatch(
                socket,
                message.body,
                message.mode,
                remote,
                message.declaredLength,
              ),
            )
            .catch((error: unknown) => {
              const text =
                error instanceof Error
                  ? error.message
                  : String(error);

              this.logger.error(
                `Processing queue failed [${remote}]: ${text}`,
              );
            });
        }

        this.logger.debug(
          `Complete messages: ${completeMessageCount}; ` +
            `buffered bytes: ${receiveBuffer.length}; ` +
            `mode=${detectedMode ?? this.framingMode}`,
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
        this.logger.warn(
          `Client ended connection with ${receiveBuffer.length} ` +
            `unprocessed bytes [${remote}]`,
        );
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

  private tryExtractMessage(
    buffer: Buffer,
    mode: FramingMode,
  ): ExtractionResult {
    switch (mode) {
      case 'mli2be-total':
        return this.extractMli2Be(buffer, true);

      case 'mli2be-body':
        return this.extractMli2Be(buffer, false);

      case 'trace-log':
        return this.extractTraceLog(buffer);

      case 'newline':
        return this.extractNewlineMessage(buffer);

      case 'auto':
        return this.autoDetectAndExtract(buffer);

      default: {
        const exhaustiveCheck: never = mode;
        throw new Error(
          `Unsupported framing mode: ${String(exhaustiveCheck)}`,
        );
      }
    }
  }

  private autoDetectAndExtract(
    buffer: Buffer,
  ): ExtractionResult {
    /*
     * Trace text is checked before binary MLI because an ASCII trace
     * begins with bytes such as "25", which can look like a large
     * two-byte integer (0x3235 = 12853).
     */
    if (this.looksLikeTraceLog(buffer)) {
      return this.extractTraceLog(buffer);
    }

    /*
     * A two-byte MLI cannot be evaluated until both header bytes arrive.
     */
    if (buffer.length < MLI_HEADER_LENGTH) {
      return { status: 'need-more' };
    }

    const declaredTotalLength = buffer.readUInt16BE(0);
    const totalBodyLength =
      declaredTotalLength - MLI_HEADER_LENGTH;

    if (
      declaredTotalLength >= MLI_HEADER_LENGTH &&
      this.isValidBodyLength(totalBodyLength)
    ) {
      return this.extractMli2Be(buffer, true);
    }

    const declaredBodyLength = buffer.readUInt16BE(0);

    if (this.isValidBodyLength(declaredBodyLength)) {
      return this.extractMli2Be(buffer, false);
    }

    /*
     * Newline framing is only selected for printable text. This avoids
     * treating arbitrary binary data containing 0x0A as a text message.
     */
    if (this.looksLikePrintableText(buffer)) {
      const newlineResult = this.extractNewlineMessage(buffer);

      if (newlineResult.status === 'message') {
        return newlineResult;
      }

      /*
       * A printable buffer may be a partial trace line. Give it more
       * data before rejecting it.
       */
      if (buffer.length < 4096) {
        return { status: 'need-more' };
      }
    }

    throw new Error(
      `Unable to detect framing protocol; firstBytes=` +
        buffer.subarray(0, 16).toString('hex'),
    );
  }

  private extractMli2Be(
    buffer: Buffer,
    lengthIncludesHeader: boolean,
  ): ExtractionResult {
    if (buffer.length < MLI_HEADER_LENGTH) {
      return { status: 'need-more' };
    }

    const declaredLength = buffer.readUInt16BE(0);
    const totalLength = lengthIncludesHeader
      ? declaredLength
      : declaredLength + MLI_HEADER_LENGTH;

    const bodyLength = totalLength - MLI_HEADER_LENGTH;

    if (!this.isValidBodyLength(bodyLength)) {
      throw new Error(
        `Invalid MLI body length ${bodyLength}; accepted range is ` +
          `${this.minBodyLength}-${this.maxBodyLength}`,
      );
    }

    if (buffer.length < totalLength) {
      return { status: 'need-more' };
    }

    return {
      status: 'message',
      message: {
        mode: lengthIncludesHeader
          ? 'mli2be-total'
          : 'mli2be-body',
        body: Buffer.from(
          buffer.subarray(MLI_HEADER_LENGTH, totalLength),
        ),
        bytesConsumed: totalLength,
        declaredLength,
      },
    };
  }

  private extractTraceLog(
    buffer: Buffer,
  ): ExtractionResult {
    const text = buffer.toString('latin1');

    const startMatch =
      /REQUEST>>Length=(\d+)->[ \t]*/.exec(text);

    if (!startMatch || startMatch.index === undefined) {
      if (buffer.length < 4096) {
        return { status: 'need-more' };
      }

      throw new Error(
        'Trace input does not contain REQUEST>>Length=<n>->',
      );
    }

    const declaredLength = Number(startMatch[1]);

    if (
      !Number.isInteger(declaredLength) ||
      !this.isValidBodyLength(declaredLength)
    ) {
      throw new Error(
        `Invalid trace body length ${startMatch[1]}; accepted range is ` +
          `${this.minBodyLength}-${this.maxBodyLength}`,
      );
    }

    const bodyStart =
      startMatch.index + startMatch[0].length;

    const remainder = text.slice(bodyStart);

    /*
     * The next trace record marks the end of the request body.
     * It is intentionally recognized by REQUEST>>Message rather than
     * by one exact logger/class prefix.
     */
    const endMatch =
      /\r?\n(?=[^\r\n]*REQUEST>>Message\s*=)/.exec(remainder);

    if (!endMatch || endMatch.index === undefined) {
      return { status: 'need-more' };
    }

    const wrappedBody = remainder.slice(0, endMatch.index);

    /*
     * Trace viewers commonly wrap a fixed-width message across lines.
     * Remove only CR/LF characters. Preserve spaces and all other bytes.
     */
    const bodyText = wrappedBody.replace(/[\r\n]/g, '');
    const body = Buffer.from(bodyText, 'latin1');

    if (body.length !== declaredLength) {
      throw new Error(
        `Trace length mismatch: trace declares ${declaredLength} bytes, ` +
          `but extracted ${body.length} bytes`,
      );
    }

    const markerStart = bodyStart + endMatch.index;
    const markerLineEnd = this.findLineEnd(text, markerStart);

    /*
     * Do not consume a partially received marker line. TCP can split
     * the logger record anywhere.
     */
    if (markerLineEnd === -1) {
      return { status: 'need-more' };
    }

    const bytesConsumed = markerLineEnd;

    return {
      status: 'message',
      message: {
        mode: 'trace-log',
        body,
        bytesConsumed,
        declaredLength,
      },
    };
  }

  private extractNewlineMessage(
    buffer: Buffer,
  ): ExtractionResult {
    const newlineIndex = buffer.indexOf(0x0a);

    if (newlineIndex === -1) {
      if (buffer.length > this.maxBodyLength) {
        throw new Error(
          `Newline-delimited message exceeded ` +
            `${this.maxBodyLength} bytes`,
        );
      }

      return { status: 'need-more' };
    }

    let bodyEnd = newlineIndex;

    if (
      bodyEnd > 0 &&
      buffer[bodyEnd - 1] === 0x0d
    ) {
      bodyEnd -= 1;
    }

    const body = Buffer.from(buffer.subarray(0, bodyEnd));

    if (!this.isValidBodyLength(body.length)) {
      throw new Error(
        `Invalid newline-delimited body length ${body.length}; ` +
          `accepted range is ${this.minBodyLength}-` +
          `${this.maxBodyLength}`,
      );
    }

    return {
      status: 'message',
      message: {
        mode: 'newline',
        body,
        bytesConsumed: newlineIndex + 1,
      },
    };
  }

  private async dispatch(
    socket: net.Socket,
    bodyBuffer: Buffer,
    mode: Exclude<FramingMode, 'auto'>,
    remote: string,
    declaredLength?: number,
  ): Promise<void> {
    try {
      if (!this.isValidBodyLength(bodyBuffer.length)) {
        throw new Error(
          `Body length ${bodyBuffer.length} is outside accepted range ` +
            `${this.minBodyLength}-${this.maxBodyLength}`,
        );
      }

      /*
       * Transport framing is finished here. The TMI service/parser owns
       * message-specific validation, field layouts and message types.
       */
      const rawBody = bodyBuffer.toString('latin1');
      const result =
        await this.tmiService.processRawString(rawBody);

      this.logger.log(
        `Processed ${bodyBuffer.length}-byte body from ${remote}; ` +
          `mode=${mode}` +
          (declaredLength === undefined
            ? ''
            : `; declaredLength=${declaredLength}`),
      );

      /*
       * This remains a development response. A production peer may
       * require its response to be framed with the same protocol.
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
        `Failed to process message [${remote}]: ${message}`,
      );

      this.safeWrite(
        socket,
        `${JSON.stringify({ error: message })}\n`,
        remote,
      );
    }
  }

  private looksLikeTraceLog(buffer: Buffer): boolean {
    const preview = buffer
      .subarray(0, Math.min(buffer.length, 2048))
      .toString('latin1');

    return (
      preview.includes('REQUEST>>Length=') ||
      /^\d{2}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}/.test(
        preview,
      )
    );
  }

  private looksLikePrintableText(buffer: Buffer): boolean {
    const sample = buffer.subarray(
      0,
      Math.min(buffer.length, 256),
    );

    if (sample.length === 0) {
      return false;
    }

    let printable = 0;

    for (const byte of sample) {
      if (
        byte === 0x09 ||
        byte === 0x0a ||
        byte === 0x0d ||
        (byte >= 0x20 && byte <= 0x7e)
      ) {
        printable += 1;
      }
    }

    return printable / sample.length >= 0.95;
  }

  private isValidBodyLength(length: number): boolean {
    return (
      Number.isInteger(length) &&
      length >= this.minBodyLength &&
      length <= this.maxBodyLength
    );
  }

  private findLineEnd(
    text: string,
    start: number,
  ): number {
    const newline = text.indexOf('\n', start);

    return newline === -1
      ? -1
      : newline + 1;
  }

  private safeWrite(
    socket: net.Socket,
    data: string | Buffer,
    remote: string,
  ): void {
    if (socket.destroyed || !socket.writable) {
      this.logger.warn(
        `Response not sent because socket is not writable [${remote}]`,
      );
      return;
    }

    socket.write(data, (error?: Error) => {
      if (error) {
        this.logger.error(
          `Failed to write response [${remote}]: ${error.message}`,
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

  private readFramingMode(value: string): FramingMode {
    const normalized = value.trim().toLowerCase();

    const supported: FramingMode[] = [
      'auto',
      'mli2be-total',
      'mli2be-body',
      'trace-log',
      'newline',
    ];

    if (!supported.includes(normalized as FramingMode)) {
      throw new Error(
        `Invalid TCP_FRAMING_MODE "${value}". Supported values: ` +
          supported.join(', '),
      );
    }

    return normalized as FramingMode;
  }

  private readInteger(
    keys: string[],
    fallback: number,
    min: number,
    max: number,
  ): number {
    const raw = keys
      .map((key) =>
        this.configService.get<string | number>(key),
      )
      .find((value) => value !== undefined);

    const value =
      raw === undefined ? fallback : Number(raw);

    if (
      !Number.isInteger(value) ||
      value < min ||
      value > max
    ) {
      throw new Error(
        `Invalid ${keys.join('/')} value "${String(raw)}"; ` +
          `expected integer ${min}-${max}`,
      );
    }

    return value;
  }

  private readBoolean(
    keys: string[],
    fallback: boolean,
  ): boolean {
    const raw = keys
      .map((key) =>
        this.configService.get<string | boolean>(key),
      )
      .find((value) => value !== undefined);

    if (raw === undefined) {
      return fallback;
    }

    if (typeof raw === 'boolean') {
      return raw;
    }

    const normalized = raw.trim().toLowerCase();

    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }

    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false;
    }

    throw new Error(
      `Invalid boolean ${keys.join('/')} value "${raw}"`,
    );
  }
}
