import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, constants, fstatSync, linkSync, lstatSync, mkdirSync,
  openSync, readSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './constants.js';
import { MessageItemType, type WeixinMessage } from './wechat/types.js';

const MAX_INPUT = 8000;
const MAX_REPLY = 3900;
const REPLY_WINDOW_MS = 30 * 60_000;
const TASK_ID = /^[a-f0-9]{64}$/;
const PREFIX = /^(?:\/grok|@?coo)(?=$|[\s:：])[\s:：]*/i;
const defaultDirectory = join(DATA_DIR, 'grok-bot');

interface GrokConfig {
  accountId: string;
  webhookUrl: string;
  webhookKey: string;
}

type Receipt = {
  expiresAt: number;
  pid: number;
  state: 'dispatching' | 'accepted' | 'dispatch_unknown' | 'rejected'
    | 'sending' | 'sent' | 'delivery_unknown' | 'expired';
};

interface Pending {
  receipt: Receipt;
  send: (text: string) => Promise<void>;
}

function isPrivate(info: { uid: number; mode: number }): boolean {
  return info.uid === process.getuid?.() && (info.mode & 0o077) === 0;
}

function ensureDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  checkDirectory(directory);
}

function checkDirectory(directory: string): void {
  const info = lstatSync(directory);
  if (!info.isDirectory() || !isPrivate(info)) throw new Error('unsafe_grok_directory');
}

function readPrivate(path: string, maxBytes: number): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || !isPrivate(info) || info.size > maxBytes) throw new Error('unsafe_grok_file');
    const bytes = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length === bytes.length) throw new Error('grok_file_too_large');
    return bytes.toString('utf8', 0, length);
  } finally {
    closeSync(fd);
  }
}

export function loadGrokConfig(directory = defaultDirectory): GrokConfig | undefined {
  try {
    checkDirectory(directory);
    const { accountId, webhookUrl, webhookKey } = JSON.parse(readPrivate(join(directory, 'config.json'), 8192));
    if (typeof accountId !== 'string' || !/^[\w.@=-]+$/.test(accountId)
      || typeof webhookUrl !== 'string' || /[\s\u0000-\u001f]/.test(webhookUrl)
      || typeof webhookKey !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(webhookKey)) return;
    const url = new URL(webhookUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return;
    return { accountId, webhookUrl: url.href, webhookKey };
  } catch {
    return;
  }
}

export function grokPrompt(msg: WeixinMessage, owner: string, configured: boolean): string | undefined {
  if (msg.from_user_id !== owner || !msg.item_list?.length
    || msg.item_list.some(item => item.type !== MessageItemType.TEXT)) return;
  const text = msg.item_list.map(item => item.text_item?.text ?? '').join('\n');
  const prefix = (configured ? PREFIX : /^\/grok(?=$|[\s:：])[\s:：]*/i).exec(text);
  if (prefix) return text.slice(prefix[0].length).trim();
}

/** Queue one reply for a known request. Only a local process can submit it. */
export function queueGrokReply(taskId: string, text: string, directory = defaultDirectory): void {
  if (!TASK_ID.test(taskId) || !text.trim() || text.length > MAX_REPLY) throw new Error('invalid_reply');
  ensureDirectory(directory);
  const receipt: Receipt = JSON.parse(readPrivate(join(directory, taskId + '.json'), 1024));
  if (!Number.isSafeInteger(receipt.pid) || receipt.pid <= 0
    || !Number.isFinite(receipt.expiresAt) || receipt.expiresAt <= Date.now()
    || !['dispatching', 'accepted', 'dispatch_unknown'].includes(receipt.state)) {
    throw new Error('request_not_pending');
  }
  process.kill(receipt.pid, 0);
  const target = join(directory, taskId + '.reply');
  const temporary = join(directory, randomUUID() + '.tmp');
  writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
  try {
    linkSync(temporary, target);
  } finally {
    unlinkSync(temporary);
  }
}

export class GrokBot {
  private readonly pending = new Map<string, Pending>();
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly config: GrokConfig,
    private readonly directory = defaultDirectory,
    private readonly post = fetch,
    private readonly onError: () => void = () => {},
  ) {
    ensureDirectory(directory);
    this.timer = setInterval(() => {
      this.deliverReplies().catch(onError);
    }, 2000);
    this.timer.unref();
  }

  close(): void {
    clearInterval(this.timer);
    this.pending.clear();
  }

  async submit(messageId: number, text: string, send: Pending['send']): Promise<string | undefined> {
    if (!Number.isSafeInteger(messageId) || !text || text.length > MAX_INPUT) return 'Grok Bot 需要 1–8000 字符的纯文本和有效的微信消息编号。';
    if (this.pending.size >= 32) return 'Grok Bot 待回复任务已满，请稍后发送新消息。';
    const id = createHash('sha256').update(this.config.accountId + '\0' + messageId).digest('hex');
    const receipt: Receipt = { state: 'dispatching', expiresAt: Date.now() + REPLY_WINDOW_MS, pid: process.pid };
    try {
      writeFileSync(join(this.directory, id + '.json'), JSON.stringify(receipt), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
      throw error;
    }
    this.pending.set(id, { receipt, send });

    let state: Receipt['state'] = 'dispatch_unknown';
    try {
      const response = await this.post(this.config.webhookUrl, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + this.config.webhookKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'wechat-codex-code', task_id: id, text }),
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
      state = response.status === 200 ? 'accepted' : 'rejected';
      void response.body?.cancel().catch(() => {});
    } catch {
      // A timeout can occur after a routine starts. Keep the reply slot open.
    }
    this.saveReceipt(id, receipt, state);
    if (state === 'rejected') {
      this.pending.delete(id);
      this.removeReply(id);
      return 'Grok Bot 未接受任务。请检查 Routine 和私密配置。';
    }
    if (state === 'dispatch_unknown') return 'Grok Bot 接收状态暂不明确。请查看 Routine 运行记录。';
    return 'Grok Bot 已接单，完成后会尝试回到本对话。';
  }

  async deliverReplies(): Promise<void> {
    for (const [id, { receipt, send }] of this.pending) {
      if (receipt.expiresAt <= Date.now()) {
        this.saveReceipt(id, receipt, 'expired');
        this.pending.delete(id);
        this.removeReply(id);
        continue;
      }
      if (receipt.state === 'dispatching') continue;
      let text: string;
      try {
        text = readPrivate(join(this.directory, id + '.reply'), MAX_REPLY * 4);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        this.onError();
        continue;
      }
      if (!text.trim() || text.length > MAX_REPLY) {
        this.onError();
        continue;
      }
      this.saveReceipt(id, receipt, 'sending');
      this.pending.delete(id);
      let state: Receipt['state'] = 'sent';
      try {
        await send(text);
      } catch {
        state = 'delivery_unknown';
      }
      this.saveReceipt(id, receipt, state);
      this.removeReply(id);
    }
  }

  private saveReceipt(id: string, receipt: Receipt, state: Receipt['state']): void {
    // Publish a complete receipt for the separate local reply process.
    const temporary = join(this.directory, randomUUID() + '.tmp');
    const target = join(this.directory, id + '.json');
    writeFileSync(temporary, JSON.stringify({ ...receipt, state }), { flag: 'wx', mode: 0o600 });
    try {
      renameSync(temporary, target);
    } catch (error) {
      unlinkSync(temporary);
      throw error;
    }
    receipt.state = state;
  }

  private removeReply(id: string): void {
    try {
      unlinkSync(join(this.directory, id + '.reply'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.onError();
    }
  }
}
