// SPDX-License-Identifier: Apache-2.0

export default () => ({
  port: parseInt(process.env.PORT ?? '3003', 10),
  tmsEndpoint: process.env.TMS_ENDPOINT ?? 'http://localhost:5000',
  tenantId: process.env.TENANT_ID ?? 'DEFAULT',
  timezoneOffset: process.env.TIMEZONE_OFFSET ?? '+05:00',
  authenticated: process.env.AUTHENTICATED === 'true',
  authToken: process.env.AUTH_TOKEN ?? '',
});
