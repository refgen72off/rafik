// Общий GET для загрузчиков: доверяем стандартным корням Node и УЦ Минцифры
// (сайты МосБиржи и Примсоцбанка подписаны им, а промежуточные сертификаты серверы
// не всегда отдают), следуем редиректам и возвращаем buffer + текст.
import { readFile } from 'node:fs/promises';
import { request } from 'node:https';
import { rootCertificates } from 'node:tls';
import { fileURLToPath } from 'node:url';

const CERTS_DIR = fileURLToPath(new URL('./certs/', import.meta.url));

const LOCAL_CA = await Promise.all(
  ['russian_trusted_root_ca.pem', 'russian_trusted_sub_ca_ssl_rsa2024.pem'].map((file) =>
    readFile(`${CERTS_DIR}${file}`, 'utf8'),
  ),
);

export const TRUSTED_CA = [...rootCertificates, ...LOCAL_CA];
export const USER_AGENT = 'personal-charts/1.0 (+github actions cron)';

export function get(url, { headers = {}, timeout = 45_000, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers: { 'User-Agent': USER_AGENT, ...headers }, ca: TRUSTED_CA, timeout }, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;

      if (status >= 300 && status < 400 && location && redirects > 0) {
        res.resume();
        resolve(get(new URL(location, url).toString(), { headers, timeout, redirects: redirects - 1 }));
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (status >= 400) {
          const err = new Error(`HTTP ${status} (${url})`);
          err.status = status;
          reject(err);
          return;
        }
        resolve({ status, headers: res.headers, buffer, text: buffer.toString('utf8') });
      });
    });

    req.on('timeout', () => req.destroy(new Error(`таймаут (${url})`)));
    req.on('error', reject);
    req.end();
  });
}
