import test from 'node:test';
import assert from 'node:assert/strict';

import { isNonFatalCodexNotice } from '../codex/provider.js';

test('treats the Codex unstable-feature warning as a non-fatal notice', () => {
  assert.equal(
    isNonFatalCodexNotice(
      'Under-development features enabled: chronicle. '
      + 'Under-development features are incomplete and may behave unpredictably. '
      + 'To suppress this warning, set `suppress_unstable_features_warning = true` in /tmp/config.toml.',
    ),
    true,
  );
});

test('does not hide unrelated Codex errors', () => {
  assert.equal(isNonFatalCodexNotice('Authentication failed: login expired.'), false);
  assert.equal(isNonFatalCodexNotice('Under-development features failed to initialize.'), false);
  assert.equal(isNonFatalCodexNotice('Skill descriptions failed to load.'), false);
  assert.equal(isNonFatalCodexNotice("The 'gpt-6-astra' model requires a newer version of Codex."), false);
});

test('treats the Codex 0.154 skill-budget notice as non-fatal', () => {
  assert.equal(isNonFatalCodexNotice('Skill descriptions were shortened to fit the skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.'), true);
});
