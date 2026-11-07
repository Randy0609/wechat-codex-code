import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Logger and account paths derive from homedir() at import time, so isolate HOME
// before the dynamic imports below.
const home = mkdtempSync(join(tmpdir(), 'wcx-login-test-'));
process.env.HOME = home;
process.env.USERPROFILE = home;

const { startQrLogin, waitForQrScan } = await import('../wechat/login.js');
const { redact } = await import('../logger.js');

const FAKE_QR_ID = 'SYNTHETIC-QRID-0123456789abcdef';
const FAKE_QR_IMG = 'https://example.invalid/qr?qrcode=SYNTHETIC-IMGQR-fedcba';
const FAKE_BOT_TOKEN = 'SYNTHETIC-BOTTOKEN-a1b2c3';

function readAllLogs(): string {
  const dir = join(home, '.wechat-codex-code', 'logs');
  return readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf-8')).join('');
}

test.after(() => rmSync(home, { recursive: true, force: true }));

test('QR login flow never writes QR id or bot token to logs', async () => {
  const realFetch = globalThis.fetch;
  const statuses = ['wait', 'scaned', 'confirmed'];
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.includes('get_bot_qrcode')) {
      return Response.json({ ret: 0, qrcode: FAKE_QR_ID, qrcode_img_content: FAKE_QR_IMG });
    }
    const status = statuses.shift()!;
    return Response.json(status === 'confirmed'
      ? { ret: 0, status, bot_token: FAKE_BOT_TOKEN, ilink_bot_id: 'synthetic-bot', ilink_user_id: 'synthetic-user' }
      : { ret: 0, status });
  }) as typeof fetch;

  const origSetTimeout = globalThis.setTimeout;
  // Skip the 3s poll interval; keep the 60s abort timer (it is cleared).
  globalThis.setTimeout = ((fn: () => void, ms?: number) =>
    origSetTimeout(fn, ms === 3_000 ? 0 : ms)) as typeof setTimeout;

  try {
    const { qrcodeId, qrcodeUrl } = await startQrLogin();
    assert.equal(qrcodeId, FAKE_QR_ID);
    assert.equal(qrcodeUrl, FAKE_QR_IMG);
    const account = await waitForQrScan(qrcodeId);
    assert.equal(account.botToken, FAKE_BOT_TOKEN);
    assert.equal(account.accountId, 'synthetic-bot');
  } finally {
    globalThis.fetch = realFetch;
    globalThis.setTimeout = origSetTimeout;
  }

  const logs = readAllLogs();
  assert.match(logs, /QR code obtained/);
  assert.match(logs, /Polling QR status/);
  assert.match(logs, /QR login successful/);
  for (const secret of [FAKE_QR_ID, FAKE_QR_IMG, 'SYNTHETIC-IMGQR', FAKE_BOT_TOKEN]) {
    assert.ok(!logs.includes(secret), 'log output disclosed a synthetic secret');
  }
});

test('redact masks qrcode-keyed values and query params', () => {
  for (const key of ['qrcode', 'qrcodeId', 'qrcode_id', 'qrcodeUrl', 'qrcode_img_content']) {
    const out = redact({ [key]: FAKE_QR_ID, status: 'wait' });
    assert.ok(!out.includes(FAKE_QR_ID), `key ${key} not redacted`);
    assert.match(out, /"status":"wait"/);
  }
  const url = redact({ url: `https://example.invalid/get_qrcode_status?qrcode=${FAKE_QR_ID}&x=1` });
  assert.ok(!url.includes(FAKE_QR_ID));
  assert.match(url, /qrcode=\*\*\*&x=1/);
});

test('redact still masks existing credential fields', () => {
  const out = redact({ bot_token: FAKE_BOT_TOKEN, aes_key: 'SYNTHETIC-AES', auth: `Bearer ${FAKE_BOT_TOKEN}` });
  assert.ok(!out.includes(FAKE_BOT_TOKEN));
  assert.ok(!out.includes('SYNTHETIC-AES'));
});
