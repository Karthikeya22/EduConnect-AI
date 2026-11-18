import assert from 'node:assert/strict';
import { isStaleChunkError } from './staleChunkReload';

assert.equal(
  isStaleChunkError(
    new Error(
      'Failed to fetch dynamically imported module: https://edu-connect-ai-three.vercel.app/assets/index-D_596yXv.js'
    )
  ),
  true
);
assert.equal(isStaleChunkError(new Error('Importing a module script failed.')), true);
assert.equal(isStaleChunkError(new Error('File is too large (limit 25MB)')), false);
assert.equal(isStaleChunkError(null), false);

console.log('staleChunkReload.test.ts: ok');
