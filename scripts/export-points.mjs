import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { GAME_RULES } from '../src/game-store.mjs';

// Read-only, transaction-consistent export; no second simulation writer is started.
const root = path.resolve(import.meta.dirname, '..');
const stateDir = path.resolve(process.env.MIRROR_HOME_STATE_DIR || path.join(root, 'runtime'));
const db = new DatabaseSync(path.join(stateDir, 'game.sqlite'), { readOnly: true });
try {
  db.exec('BEGIN');
  const flies = db.prepare('SELECT id,owner,seed,level,created_at,meta FROM flies ORDER BY id').all();
  const ledger = db.prepare('SELECT * FROM ledger ORDER BY id').all();
  const receipts = db.prepare('SELECT wallet,request_id,fly_id,receipt FROM reactions ORDER BY wallet,request_id').all()
    .map(row => ({ wallet: row.wallet, requestId: row.request_id, flyId: row.fly_id, ...JSON.parse(row.receipt) }));
  const wallets = db.prepare('SELECT address,balance,earned,spent FROM wallets ORDER BY address').all();
  const data = { format: 1, kind: 'research-points-snapshot', exportedAt: new Date().toISOString(),
    season: GAME_RULES.season, ruleVersion: GAME_RULES.version, conversionRatio: null,
    lastLedgerId: ledger.at(-1)?.id ?? 0, wallets,
    flies: flies.map(({ meta, ...identity }) => identity), ledger, receipts,
    unit: 'one thousandth of a response point; only committed reactions and spends; not a token entitlement' };
  db.exec('COMMIT');
  const sha256 = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  const output = path.join(stateDir, `points-snapshot-${Date.now()}.json`);
  await writeFile(output, JSON.stringify({ ...data, sha256 }, null, 2), { encoding: 'utf8', flag: 'wx' });
  console.log(`研究积分快照：${output}\n依据最后一次持久存档，不包含兑换比例；正式兑换规则尚未设定。`);
} finally { db.close(); }
