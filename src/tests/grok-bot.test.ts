import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { GrokBot, grokPrompt, loadGrokConfig, queueGrokReply } from '../grok-bot.js';
import { MessageItemType, type WeixinMessage } from '../wechat/types.js';

const config = { accountId: 'test-bot', webhookUrl: 'https://example.test/routine', webhookKey: 'fake-key' };
const message = (text: string, sender = 'owner'): WeixinMessage => ({
  from_user_id: sender,
  item_list: [{ type: MessageItemType.TEXT, text_item: { text } }],
});

test('only explicit owner text can route to Grok Bot', () => {
  assert.equal(grokPrompt(message('/grok hello'), 'owner', true), 'hello');
  assert.equal(grokPrompt(message('COO：你好'), 'owner', true), '你好');
  assert.equal(grokPrompt(message('@COO hello'), 'owner', true), 'hello');
  for (const text of ['普通消息', '/status', 'COOL down', '/grokking', '请联系 COO']) {
    assert.equal(grokPrompt(message(text), 'owner', true), undefined);
  }
  assert.equal(grokPrompt(message('COO hello', 'other'), 'owner', true), undefined);
  assert.equal(grokPrompt(message('COO hello'), 'owner', false), undefined);
  assert.equal(grokPrompt(message('/grok hello'), 'owner', false), 'hello');
  const attachment = message('/grok with attachment');
  attachment.item_list!.push({ type: MessageItemType.IMAGE });
  assert.equal(grokPrompt(attachment, 'owner', true), undefined);
});

test('loads an owner-only HTTPS config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wcx-grok-config-'));
  try {
    const path = join(dir, 'config.json');
    assert.equal(loadGrokConfig(dir), undefined);
    writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
    assert.deepEqual(loadGrokConfig(dir), config);
    writeFileSync(path, JSON.stringify({ ...config, webhookUrl: 'http://example.test/routine' }));
    assert.equal(loadGrokConfig(dir), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const dispatch of ['accepted', 'rejected', 'unknown'] as const) {
  test(`dispatch ${dispatch} preserves request identity and only delivers a matching reply once`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wcx-grok-test-'));
    let taskId = '';
    const requests: { url: unknown; init?: RequestInit }[] = [];
    const replies: string[] = [];
    const send = async (text: string) => { replies.push(text); };
    const post: typeof fetch = async (url, init) => {
      requests.push({ url, init });
      if (dispatch === 'unknown') throw new Error('synthetic timeout');
      return new Response(null, { status: dispatch === 'accepted' ? 200 : 401 });
    };
    const bridge = new GrokBot(config, dir, post);
    try {
      const ack = await bridge.submit(42, 'safe input', send);
      assert.match(ack ?? '', dispatch === 'accepted' ? /已接单/ : dispatch === 'rejected' ? /未接受/ : /不明确/);
      const { url, init } = requests[0];
      assert.equal(url, config.webhookUrl);
      assert.equal(init?.redirect, 'error');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fake-key');
      const body = JSON.parse(String(init?.body));
      taskId = body.task_id;
      assert.deepEqual(body, { source: 'wechat-codex-code', task_id: taskId, text: 'safe input' });
      assert.match(taskId, /^[a-f0-9]{64}$/);
      assert.equal(await bridge.submit(42, 'safe input', send), undefined);
      assert.equal(requests.length, 1);
      assert.throws(() => queueGrokReply('f'.repeat(64), 'unmatched', dir));
      if (dispatch === 'rejected') {
        assert.throws(() => queueGrokReply(taskId, 'refused', dir));
        return;
      }
      queueGrokReply(taskId, 'safe output', dir);
      assert.throws(() => queueGrokReply(taskId, 'duplicate', dir));
      await Promise.all([bridge.deliverReplies(), bridge.deliverReplies()]);
      assert.deepEqual(replies, ['safe output']);
      assert.equal(JSON.parse(readFileSync(join(dir, taskId + '.json'), 'utf8')).state, 'sent');
      assert.throws(() => queueGrokReply(taskId, 'late', dir));
    } finally {
      bridge.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
