import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { getAddress } from 'ethers';
import { LifeSimulation, ValidationError } from './simulation.mjs';
import { PROTOCOL_VERSION } from './neural-research.mjs';

export const GAME_RULES = Object.freeze({ version: 'reaction-alpha-1', season: 'local-alpha-1',
  maxLevel: 5, maxResponsePoints: 10, researchCooldown: 20 });
const round = value => Math.round(value * 1000) / 1000;
const points = milli => round(milli / 1000);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const valid = (condition, message, status = 400) => { if (!condition) throw new ValidationError(message, status); };
function wallet(address) {
  try { return getAddress(address).toLowerCase(); }
  catch { throw new ValidationError('钱包地址无效'); }
}
function requestId(value) {
  valid(typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value), '操作编号无效');
  return value.toLowerCase();
}
const copy = value => structuredClone(value);
const responseMultiplier = room => 1 + 0.25 * (room.level - 1);

function validateResearchResult(result) {
  valid(result && typeof result === 'object' && !Array.isArray(result)
    && ['baseline', 'activation', 'recovery'].every(key => Number.isFinite(result[key]) && result[key] >= 0 && result[key] < 1000)
    && Number.isFinite(result.computeSeconds) && result.computeSeconds > 0
    && typeof result.modelFingerprint === 'string' && /^[a-f0-9]{64}$/.test(result.modelFingerprint)
    && result.protocolVersion === PROTOCOL_VERSION, '神经实验结果无效，未结算积分', 502);
}

// Wallet balances and individual growth deliberately have different owners.
// All monetary integers are thousandths of a research point, never token amounts.
export class GameStore {
  constructor(filename, { now = () => Date.now() } = {}) {
    this.now = now;
    this.db = new DatabaseSync(filename);
    this.rooms = new Map();
    try {
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;');
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      valid([0, 1, 2].includes(version), '游戏账本版本不兼容，原文件已保留', 503);
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS wallets (
            address TEXT PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0 CHECK(balance>=0),
            earned INTEGER NOT NULL DEFAULT 0 CHECK(earned>=0), spent INTEGER NOT NULL DEFAULT 0 CHECK(spent>=0),
            created_at TEXT NOT NULL
          ) STRICT;
          CREATE TABLE IF NOT EXISTS flies (
            id TEXT PRIMARY KEY, owner TEXT NOT NULL UNIQUE REFERENCES wallets(address),
            seed INTEGER NOT NULL, level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 5),
            created_at TEXT NOT NULL, simulation TEXT NOT NULL, meta TEXT NOT NULL
          ) STRICT;
          CREATE TABLE IF NOT EXISTS ledger (
            id INTEGER PRIMARY KEY, wallet TEXT NOT NULL REFERENCES wallets(address), fly_id TEXT NOT NULL REFERENCES flies(id),
            kind TEXT NOT NULL, delta INTEGER NOT NULL, balance INTEGER NOT NULL CHECK(balance>=0),
            at TEXT NOT NULL, rule_version TEXT NOT NULL, season TEXT NOT NULL, source_request_id TEXT
          ) STRICT;
          CREATE TABLE IF NOT EXISTS operations (
            wallet TEXT NOT NULL REFERENCES wallets(address), request_id TEXT NOT NULL,
            kind TEXT NOT NULL, payload_hash TEXT NOT NULL, status TEXT NOT NULL,
            PRIMARY KEY(wallet, request_id)
          ) STRICT;
          CREATE TABLE IF NOT EXISTS reactions (
            wallet TEXT NOT NULL REFERENCES wallets(address), request_id TEXT NOT NULL,
            fly_id TEXT NOT NULL REFERENCES flies(id), receipt TEXT NOT NULL,
            PRIMARY KEY(wallet,request_id),
            FOREIGN KEY(wallet,request_id) REFERENCES operations(wallet,request_id)
          ) STRICT;
          CREATE INDEX IF NOT EXISTS ledger_wallet_id ON ledger(wallet,id);
        `);
        if (!this.db.prepare('PRAGMA table_info(ledger)').all().some(column => column.name === 'source_request_id')) {
          this.db.exec('ALTER TABLE ledger ADD COLUMN source_request_id TEXT');
        }
        this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ledger_wallet_request ON ledger(wallet,source_request_id)');
        this.db.exec("UPDATE operations SET status='interrupted' WHERE status='pending'");
        for (const row of this.db.prepare('SELECT * FROM flies').all()) {
          const simulation = new LifeSimulation(JSON.parse(row.simulation));
          // Player rooms never inherit a demo clock speed or pause flag.
          simulation.setSpeed(1); simulation.setPaused(false);
          const savedMeta = JSON.parse(row.meta);
          valid(savedMeta && typeof savedMeta === 'object' && !Array.isArray(savedMeta)
            && Number.isFinite(savedMeta.cooldownRemaining) && savedMeta.cooldownRemaining >= 0
            && savedMeta.cooldownRemaining <= GAME_RULES.researchCooldown && Array.isArray(savedMeta.history),
          '研究状态存档损坏，原文件已保留', 503);
          // Legacy automatic production is retired without changing historical ledger rows.
          const { boostMultiplier, boostRemaining, accrual, ...meta } = savedMeta;
          const room = { ...row, simulation, meta };
          this.rooms.set(row.owner, room);
          if (version < 2 || ['boostMultiplier', 'boostRemaining', 'accrual'].some(key => Object.hasOwn(savedMeta, key))) this.saveRoom(room);
        }
        this.db.exec('PRAGMA user_version=2');
      });
    } catch (error) { this.db.close(); throw error; }
    this.error = null;
  }

  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); this.error = null; return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  requireRoom(address) {
    const room = this.rooms.get(wallet(address));
    valid(room, '请先领取自己的果蝇', 409);
    return room;
  }

  operation(address, id, kind, payload) {
    id = requestId(id);
    const hash = digest(payload);
    const existing = this.db.prepare('SELECT * FROM operations WHERE wallet=? AND request_id=?').get(address, id);
    if (existing) valid(existing.kind === kind && existing.payload_hash === hash, '操作编号已用于其他请求', 409);
    return { id, hash, existing };
  }

  saveRoom(room) {
    this.db.prepare('UPDATE flies SET level=?,simulation=?,meta=? WHERE id=?').run(
      room.level, JSON.stringify(room.simulation.serialize()), JSON.stringify(room.meta), room.id);
  }

  record(address, room, kind, delta, sourceRequestId) {
    valid(Number.isSafeInteger(delta) && (kind === 'reaction' ? delta >= 0 : delta < 0), '积分结算无效', 500);
    sourceRequestId = requestId(sourceRequestId);
    const current = this.db.prepare('SELECT * FROM wallets WHERE address=?').get(address);
    const balance = current.balance + delta;
    valid(Number.isSafeInteger(balance) && balance >= 0, '研究积分不足', 409);
    valid(Number.isSafeInteger(current.earned + Math.max(0, delta))
      && Number.isSafeInteger(current.spent + Math.max(0, -delta)), '积分账本已达到容量上限', 503);
    this.db.prepare('UPDATE wallets SET balance=?,earned=earned+?,spent=spent+? WHERE address=?')
      .run(balance, Math.max(0, delta), Math.max(0, -delta), address);
    this.db.prepare('INSERT INTO ledger(wallet,fly_id,kind,delta,balance,at,rule_version,season,source_request_id) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(address, room.id, kind, delta, balance, new Date(this.now()).toISOString(), GAME_RULES.version, GAME_RULES.season, sourceRequestId);
  }

  claim(address, id) {
    address = wallet(address); requestId(id);
    if (this.rooms.has(address)) return this.requireRoom(address).id;
    const seed = randomBytes(4).readUInt32LE() || 1;
    const createdAt = new Date(this.now()).toISOString();
    const room = { id: randomUUID(), owner: address, seed, level: 1, created_at: createdAt,
      simulation: new LifeSimulation(null, { seed }), meta: { cooldownRemaining: 0, latest: null, history: [] } };
    this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO wallets(address,created_at) VALUES(?,?)').run(address, createdAt);
      this.db.prepare('INSERT INTO flies(id,owner,seed,level,created_at,simulation,meta) VALUES(?,?,?,?,?,?,?)')
        .run(room.id, address, seed, 1, createdAt, JSON.stringify(room.simulation.serialize()), JSON.stringify(room.meta));
      this.db.prepare('INSERT INTO operations VALUES(?,?,?,?,?)').run(address, requestId(id), 'claim', digest({}), 'done');
    });
    this.rooms.set(address, room);
    return room.id;
  }

  tick(seconds) {
    valid(Number.isFinite(seconds) && seconds > 0 && seconds <= 1, '无效的服务器时间步长', 500);
    for (const room of this.rooms.values()) {
      room.simulation.tick(seconds);
      room.meta.cooldownRemaining = Math.max(0, room.meta.cooldownRemaining - seconds);
    }
  }

  flush({ address = null } = {}) {
    const rooms = address ? [this.requireRoom(address)] : [...this.rooms.values()];
    try {
      this.transaction(() => {
        for (const room of rooms) this.saveRoom(room);
      });
    } catch (error) { this.error = error.message; throw error; }
  }

  mutate(address, apply) {
    address = wallet(address);
    const original = this.requireRoom(address);
    const next = { ...original, meta: copy(original.meta), simulation: new LifeSimulation(original.simulation.serialize()) };
    this.transaction(() => { apply(next, address); this.saveRoom(next); });
    this.rooms.set(address, next);
    return next;
  }

  interact(address, type) {
    valid(['feed', 'mist', 'chime'].includes(type), '个人房间不支持加速或暂停时钟');
    this.mutate(address, room => room.simulation.interact(type));
  }

  upgrade(address, id) {
    address = wallet(address);
    this.requireRoom(address);
    const operation = this.operation(address, id, 'upgrade', {});
    if (operation.existing) return;
    this.mutate(address, room => {
      valid(room.level < GAME_RULES.maxLevel, '已达到本轮最高等级', 409);
      this.record(address, room, 'upgrade', -20 * room.level ** 2 * 1000, operation.id);
      room.level++;
      this.db.prepare('INSERT INTO operations VALUES(?,?,?,?,?)').run(address, operation.id, 'upgrade', operation.hash, 'done');
    });
  }

  beginResearch(address, { requestId: id, stimulus, intensity }) {
    address = wallet(address);
    valid(['feed', 'mist', 'chime'].includes(stimulus) && [0.25, 0.5, 1].includes(intensity), '刺激或强度无效');
    const room = this.requireRoom(address);
    const operation = this.operation(address, id, 'research', { stimulus, intensity });
    if (operation.existing) {
      valid(operation.existing.status === 'done', '这次实验正在进行或已中断，请查看结果后再发起新实验', 409);
      return { replay: true };
    }
    valid(room.meta.cooldownRemaining <= 0, `请等 ${Math.ceil(room.meta.cooldownRemaining)} 秒后再做实验`, 429);
    valid(!this.db.prepare("SELECT 1 FROM operations WHERE wallet=? AND status='pending'").get(address), '已有实验正在计算', 409);
    this.mutate(address, next => {
      next.meta.cooldownRemaining = GAME_RULES.researchCooldown;
      this.db.prepare('INSERT INTO operations VALUES(?,?,?,?,?)').run(address, operation.id, 'research', operation.hash, 'pending');
    });
    return { seed: room.seed, replay: false };
  }

  finishResearch(address, { requestId: id, stimulus, intensity }, result) {
    address = wallet(address);
    const operation = this.operation(address, id, 'research', { stimulus, intensity });
    valid(operation.existing?.status === 'pending', '实验不处于可结算状态', 409);
    validateResearchResult(result);
    const next = this.mutate(address, room => {
      const netActivation = Math.max(0, result.activation - result.baseline);
      const multiplier = responseMultiplier(room);
      // This bounded saturation curve is an adjustable game rule, not a scientific value score.
      const reward = Math.floor(GAME_RULES.maxResponsePoints * 1000 * multiplier * netActivation / (netActivation + 0.2));
      const latest = { requestId: operation.id, flyId: room.id, seed: room.seed, stimulus, intensity, baseline: result.baseline,
        activation: result.activation, recovery: result.recovery, netActivation,
        pointsAwarded: points(reward), responseMultiplier: multiplier, ruleVersion: GAME_RULES.version,
        computeSeconds: result.computeSeconds, modelFingerprint: result.modelFingerprint,
        protocolVersion: result.protocolVersion, at: new Date(this.now()).toISOString() };
      this.record(address, room, 'reaction', reward, operation.id);
      this.db.prepare('INSERT INTO reactions(wallet,request_id,fly_id,receipt) VALUES(?,?,?,?)')
        .run(address, operation.id, room.id, JSON.stringify(latest));
      room.meta.latest = latest;
      room.meta.history = [latest, ...room.meta.history].slice(0, 8);
      if (room.simulation.snapshot().cooldowns[stimulus] === 0) room.simulation.interact(stimulus);
      this.db.prepare("UPDATE operations SET status='done' WHERE wallet=? AND request_id=?").run(address, operation.id);
    });
    return copy(next.meta.latest);
  }

  failResearch(address, id) {
    this.db.prepare("UPDATE operations SET status='failed' WHERE wallet=? AND request_id=? AND status='pending'")
      .run(wallet(address), requestId(id));
  }

  account(address) {
    address = wallet(address);
    const room = this.rooms.get(address);
    const balance = this.db.prepare('SELECT * FROM wallets WHERE address=?').get(address);
    const common = { authenticated: true, address, fly: null,
      points: { balance: points(balance?.balance || 0), earned: points(balance?.earned || 0),
        spent: points(balance?.spent || 0), season: GAME_RULES.season },
      research: { cooldownRemaining: 0, latest: null, history: [] }, ledger: [] };
    if (!room) return common;
    return { ...common, fly: { id: room.id, name: `镜隙 · ${room.id.slice(0, 6).toUpperCase()}`,
      level: room.level, kind: 'offchain', createdAt: room.created_at },
      production: { responseMultiplier: responseMultiplier(room), maxPointsPerExperiment: GAME_RULES.maxResponsePoints * responseMultiplier(room),
        ruleVersion: GAME_RULES.version,
        upgradeCost: room.level < GAME_RULES.maxLevel ? 20 * room.level ** 2 : null, maxLevel: GAME_RULES.maxLevel },
      research: { cooldownRemaining: Math.ceil(room.meta.cooldownRemaining), latest: copy(room.meta.latest), history: copy(room.meta.history) },
      ledger: this.db.prepare('SELECT * FROM ledger WHERE wallet=? ORDER BY id DESC LIMIT 12').all(address).map(row => ({
        id: row.id, kind: row.kind, delta: points(row.delta), balance: points(row.balance), at: row.at,
        requestId: row.source_request_id, ruleVersion: row.rule_version,
        label: row.kind === 'reaction' ? '刺激反应积分' : row.kind === 'collect' ? '历史样本采集' : '升级消耗'
      })) };
  }

  snapshot(address) { return this.rooms.get(wallet(address))?.simulation.snapshot() ?? null; }

  exportSnapshot() {
    const ledgerRows = this.db.prepare('SELECT * FROM ledger ORDER BY id').all();
    const data = { format: 1, kind: 'research-points-snapshot', exportedAt: new Date(this.now()).toISOString(),
      season: GAME_RULES.season, ruleVersion: GAME_RULES.version, conversionRatio: null,
      lastLedgerId: ledgerRows.at(-1)?.id ?? 0,
      wallets: this.db.prepare('SELECT address,balance,earned,spent FROM wallets ORDER BY address').all(),
      flies: this.db.prepare('SELECT id,owner,seed,level,created_at FROM flies ORDER BY id').all(),
      receipts: this.db.prepare('SELECT wallet,request_id,fly_id,receipt FROM reactions ORDER BY wallet,request_id').all()
        .map(row => ({ wallet: row.wallet, requestId: row.request_id, flyId: row.fly_id, ...JSON.parse(row.receipt) })),
      ledger: ledgerRows, unit: 'one thousandth of a research point; not a token entitlement' };
    return { ...data, sha256: digest(data) };
  }

  close() { this.flush(); this.db.close(); }
}
