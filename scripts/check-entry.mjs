import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

// Product-critical pure and native integration tests; browser tools run separately.
const pattern=/^(coop-|mirror-coop-|mechanical-|tapeout-|entry-source-export|playwright-module|resource-arrival|resource-signal-arrival|route-planner|three-addon-closure).*\.test\.mjs$/;
const files=(await fs.readdir('tests')).filter(name=>pattern.test(name)).sort().map(name=>'tests/'+name);
if(!files.length)throw Error('No entry tests were found; run from the source root');
const result=spawnSync(process.execPath,['--test','--test-concurrency=2',...files],{stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
