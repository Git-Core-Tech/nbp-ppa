// SPDX-License-Identifier: Apache-2.0

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received "${value}"`);
  }

  return parsed;
}

export default () => ({
  port: positiveInteger(process.env.PORT, 3003),

  tcpPort: positiveInteger(process.env.TCP_PORT, 3004),
  tcpHost: process.env.TCP_HOST ?? '0.0.0.0',

  msgLength: Number.parseInt(process.env.MSG_LENGTH ?? '0', 10),
  tmiInputMode: process.env.TMI_INPUT_MODE ?? 'trace',

  tmsEndpoint: (
    process.env.TMS_ENDPOINT ?? 'http://localhost:5000'
  ).replace(/\/+$/, ''),

  tmsRequestTimeoutMs: positiveInteger(
    process.env.TMS_REQUEST_TIMEOUT_MS,
    30_000,
  ),

  tenantId: process.env.TENANT_ID ?? 'DEFAULT',
  timezoneOffset: process.env.TIMEZONE_OFFSET ?? '+05:00',

  authenticated: process.env.AUTHENTICATED === 'true',
  authToken: process.env.AUTH_TOKEN ?? '',

  dbHost: process.env.DB_HOST ?? 'localhost',
  dbPort: positiveInteger(process.env.DB_PORT, 15432),
  dbUser: process.env.DB_USER ?? 'postgres',
  dbPassword: process.env.DB_PASSWORD ?? '',
  dbName: process.env.DB_NAME ?? 'evaluation',

  pollTimeoutMs: positiveInteger(process.env.POLL_TIMEOUT_MS, 10_000),
  pollIntervalMs: positiveInteger(process.env.POLL_INTERVAL_MS, 500),
});