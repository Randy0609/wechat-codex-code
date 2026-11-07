import { queueGrokReply } from '../grok-bot.js';

async function main(): Promise<void> {
  process.stdin.setEncoding('utf8');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 32768) throw new Error('input_too_large');
  }
  const { task_id: taskId, text } = JSON.parse(input);
  if (typeof taskId !== 'string' || typeof text !== 'string') throw new Error('invalid_reply');
  queueGrokReply(taskId, text);
  console.log('Grok Bot reply queued');
}

main().catch(() => {
  console.error('Reply refused: invalid input, unknown/expired task, or reply already queued.');
  process.exitCode = 1;
});
