// SPDX-License-Identifier: Apache-2.0

export default () => ({
  tcpPort: parseInt(process.env.TCP_PORT ?? '3004', 10),
  tcpHost: process.env.TCP_HOST ?? '0.0.0.0',
  // 0 = newline-delimited (testing); set to 1365 for real TMI1910 messages
  msgLength: parseInt(process.env.MSG_LENGTH ?? '0', 10),
  tmsEndpoint: process.env.TMS_ENDPOINT ?? 'http://localhost:5000',
  tenantId: process.env.TENANT_ID ?? 'DEFAULT',
  timezoneOffset: process.env.TIMEZONE_OFFSET ?? '+05:00',
  authenticated: process.env.AUTHENTICATED === 'true',
  authToken: process.env.AUTH_TOKEN ?? '',
});
