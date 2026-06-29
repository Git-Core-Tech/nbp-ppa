// SPDX-License-Identifier: Apache-2.0

export default () => ({
  tcpPort: parseInt(process.env.TCP_PORT ?? '3004', 10),
  tcpHost: process.env.TCP_HOST ?? '0.0.0.0',
  msgLength: parseInt(process.env.MSG_LENGTH ?? '0', 10),
  tmsEndpoint: process.env.TMS_ENDPOINT ?? 'http://localhost:5000',
  tenantId: process.env.TENANT_ID ?? 'DEFAULT',
  timezoneOffset: process.env.TIMEZONE_OFFSET ?? '+05:00',
  authenticated: process.env.AUTHENTICATED === 'true',
  authToken: process.env.AUTH_TOKEN ?? '',
  dbHost: process.env.DB_HOST ?? 'localhost',
  dbPort: parseInt(process.env.DB_PORT ?? '15432', 10),
  dbUser: process.env.DB_USER ?? 'postgres',
  dbPassword: process.env.DB_PASSWORD ?? '',
  dbName: process.env.DB_NAME ?? 'evaluation',
  pollTimeoutMs: parseInt(process.env.POLL_TIMEOUT_MS ?? '10000', 10),
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS ?? '500', 10),
});
