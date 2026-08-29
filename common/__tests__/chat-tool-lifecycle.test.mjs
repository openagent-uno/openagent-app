import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { build } from '../../desktop/node_modules/esbuild/lib/main.js';

const storeEntry = fileURLToPath(
  new URL('../../universal/stores/chat.ts', import.meta.url),
);
const appRoot = fileURLToPath(new URL('../..', import.meta.url));

const bundle = await build({
  absWorkingDir: appRoot,
  bundle: true,
  entryPoints: [storeEntry],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  write: false,
  nodePaths: [
    fileURLToPath(new URL('../../universal/node_modules', import.meta.url)),
    fileURLToPath(new URL('../../desktop/node_modules', import.meta.url)),
  ],
  plugins: [{
    name: 'chat-store-test-boundaries',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^\.\.\/services\/api$/ }, () => ({
        path: 'api', namespace: 'chat-store-test',
      }));
      buildApi.onLoad({ filter: /^api$/, namespace: 'chat-store-test' }, () => ({
        loader: 'js',
        contents: `
          export const deleteSession = async () => {};
          export const fetchSessionRuns = async () => [];
          export const getSessionContext = async () => ({});
          export const listSessionMessages = async () => ({ messages: [] });
          export const runMsgToChat = (message) => message;
          export const updateSessionMetadata = async () => {};
        `,
      }));
    },
  }],
});

const bundledSource = bundle.outputFiles[0].text;
const { appendOrPatchTool } = await import(
  `data:text/javascript;base64,${Buffer.from(bundledSource).toString('base64')}`
);

test('a sparse terminal frame preserves execution host from the started frame', () => {
  const executionHost = {
    kind: 'client',
    device_label: 'Alessandro MacBook',
    device_id: 'device-1',
    client_instance_id: 'desktop-1',
    generation: 7,
  };
  const started = {
    tool_name: 'filesystem_write_file',
    tool_call_id: 'call-1',
    tool_args: { path: '/tmp/client-only.txt' },
    tool_call_error: false,
    execution_host: executionHost,
  };
  const messages = [{
    id: 'tool-message-1',
    role: 'tool',
    text: 'Writing client-only.txt',
    timestamp: 1,
    toolInfo: started,
  }];

  const patched = appendOrPatchTool(messages, {
    tool_name: 'filesystem_write_file',
    tool_call_id: 'call-1',
    result: 'written',
    status: 'success',
  });

  assert.equal(patched.length, 1);
  assert.notStrictEqual(patched, messages);
  assert.notStrictEqual(patched[0], messages[0]);
  assert.deepEqual(patched[0].toolInfo.execution_host, executionHost);
  assert.deepEqual(patched[0].toolInfo.tool_args, started.tool_args);
  assert.equal(patched[0].toolInfo.result, 'written');
  assert.equal(patched[0].toolInfo.status, 'success');
  assert.equal(messages[0].toolInfo.result, undefined);
});
