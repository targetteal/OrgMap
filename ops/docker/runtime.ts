import { readFile } from 'node:fs/promises';
import { startSmtpSink } from '../../server/src/smtp.js';

const root = '/var/lib/orgmap';
const installation = JSON.parse(await readFile(root + '/installation.json', 'utf8'));
if (!/^orgmap_(fresh|restore)_[a-f0-9]{32}$/.test(installation.database) ||
    !['integration.json', 'restored/storage-config.json'].includes(installation.configuration))
  throw Error('ORGMAP_INSTALLATION_INVALID');
const origin = new URL(process.env.ORGMAP_PUBLIC_URL ?? '');
if (origin.origin !== process.env.ORGMAP_PUBLIC_URL ||
    (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && origin.hostname === 'localhost')))
  throw Error('ORGMAP_PUBLIC_URL_REQUIRES_HTTPS_OR_LOCALHOST');

process.loadEnvFile(root + '/app.env');
process.loadEnvFile(root + '/dispatcher.env');
process.env.ORGMAP_LIFECYCLE_LEDGER_DIRECTORY = root + '/authority';
process.env.ORGMAP_INTEGRATION_CONFIG = root + '/' + installation.configuration;
process.env.IAM_MAIL_ENV_FILE = root + '/iam-mail.env';
process.env.ALLOWED_ORIGINS = origin.origin;
process.env.COOKIE_SECURE = String(origin.protocol === 'https:');
process.env.ORGMAP_ENABLE_IAM_MAIL = 'true';

const brevoKey = process.env.BREVO_API_KEY;
if (brevoKey && !process.env.ORGMAP_MAIL_FROM)
  throw Error('ORGMAP_MAIL_FROM_REQUIRED');
if (!brevoKey) {
  delete process.env.BREVO_API_KEY;
  if (!process.env.ORGMAP_MAIL_FROM) delete process.env.ORGMAP_MAIL_FROM;
  const smtp = await startSmtpSink({ directory: root + '/local-mail' });
  smtp.unref();
}

await import(new URL('../vps/supervisor.mjs', import.meta.url).href);
