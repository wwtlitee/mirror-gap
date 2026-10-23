import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../workers/coop-entry.mjs';

test('the dedicated demo entry serves the cooperative page and preserves request semantics',async()=>{
  let received;const response=await worker.fetch(new Request('https://demo.example/?seed=8501',{method:'HEAD'}),{ASSETS:{async fetch(request){received=request;return new Response(null,{headers:{'Content-Type':'text/html'}});}}});
  assert.equal(new URL(received.url).pathname,'/coop.html');assert.equal(new URL(received.url).search,'?seed=8501');assert.equal(received.method,'HEAD');
  assert.equal(response.headers.get('X-MirrorGap-Version'),'8.5.0');assert.equal(response.headers.get('Content-Type'),'text/html');
});
test('ordinary pages and real missing assets keep their own response',async()=>{
  for(const path of ['/index.html','/training.html','/missing.mjs']){
    let received;const response=await worker.fetch(new Request('https://demo.example'+path),{ASSETS:{async fetch(request){received=request;return new Response('missing',{status:404});}}});
    assert.equal(new URL(received.url).pathname,path);assert.equal(response.status,404);assert.equal(await response.text(),'missing');
  }
});
