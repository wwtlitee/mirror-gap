import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROTOCOL_VERSION = 'home-probe-v1';
const SCRIPT = fileURLToPath(new URL('../scripts/neural-probe.py', import.meta.url));
const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MODEL_LABEL = 'FlyWire v783 子网络';
const STIMULI = ['feed', 'mist', 'chime'];
const INTENSITIES = [0.25, 0.5, 1];
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_ERROR_BYTES = 64 * 1024;
// One interpreter at a time per Node process, including callers that create a
// separate service object for each fly. The server can still use one singleton.
let activeExperiment = false;

export class NeuralResearchError extends Error {
  constructor(message, statusCode = 503, code = 'neural_unavailable') {
    super(message);
    this.name = 'NeuralResearchError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function isFile(filename) {
  try { return statSync(filename).isFile(); } catch { return false; }
}

function validateRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)
      || Object.keys(request).length !== 3
      || !['stimulus', 'intensity', 'seed'].every(key => Object.hasOwn(request, key))
      || !STIMULI.includes(request.stimulus) || !INTENSITIES.includes(request.intensity)
      || !Number.isInteger(request.seed) || request.seed < 0 || request.seed > 0xffffffff) {
    throw new NeuralResearchError('实验需要有效刺激、0.25/0.5/1 强度和服务端种子。', 400, 'invalid_research_request');
  }
}

function validateResult(result, request) {
  const fail = () => { throw new NeuralResearchError('神经实验返回的数据无效，本次未产生研究结果。', 502, 'invalid_neural_response'); };
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail();
  const keys = ['stimulus', 'intensity', 'seed', 'activation', 'recovery', 'baseline', 'peak', 'response',
    'modelFingerprint', 'protocolVersion', 'computeSeconds', 'simulationSeconds', 'neuralSeconds', 'binMs',
    'neurons', 'edges', 'mapping'];
  if (Object.keys(result).length !== keys.length || !keys.every(key => Object.hasOwn(result, key))) fail();
  if (!['stimulus', 'intensity', 'seed'].every(key => result[key] === request[key])
      || result.protocolVersion !== PROTOCOL_VERSION || !/^[a-f0-9]{64}$/.test(result.modelFingerprint)
      || result.neuralSeconds !== 1.6 || result.binMs !== 50
      || !Number.isInteger(result.neurons) || result.neurons < 96 || result.neurons > 2048
      || !Number.isInteger(result.edges) || result.edges < 1 || result.edges > 10_000_000) fail();
  for (const key of ['activation', 'recovery', 'baseline', 'peak', 'computeSeconds', 'simulationSeconds']) {
    if (typeof result[key] !== 'number' || !Number.isFinite(result[key]) || result[key] < 0) fail();
  }
  if (result.computeSeconds < result.simulationSeconds || !Array.isArray(result.response) || result.response.length !== 32) fail();
  if (!result.response.every(row => Array.isArray(row) && row.length === 16
      && row.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1000))) fail();
  const average = rows => rows.flat().reduce((sum, value) => sum + value, 0) / (rows.length * 16);
  const aggregates = { baseline: average(result.response.slice(0, 8)), activation: average(result.response.slice(8, 16)),
    recovery: average(result.response.slice(16)), peak: Math.max(...result.response.flat()) };
  if (Object.entries(aggregates).some(([key, value]) => Math.abs(result[key] - value) > 1e-9)) fail();
  const mapping = result.mapping;
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)
      || Object.keys(mapping).length !== 6 || mapping.activeChannel !== STIMULI.indexOf(request.stimulus)
      || mapping.baselineBins !== 8 || mapping.stimulusBins !== 8 || mapping.recoveryBins !== 16
      || JSON.stringify(mapping.channels) !== JSON.stringify(['gameplay_food', 'gameplay_mist', 'gameplay_chime', 'reserved'])
      || typeof mapping.notice !== 'string' || mapping.notice.length < 10 || mapping.notice.length > 180) fail();
  return result;
}

export class NeuralResearch {
  constructor({ pythonPath, modelPath, timeoutMs = 60000 } = {}) {
    const defaultPython = path.join(PROJECT_ROOT, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    this.pythonPath = path.resolve(pythonPath ?? defaultPython);
    this.modelPath = path.resolve(modelPath ?? path.join(PROJECT_ROOT, 'runtime', 'model.npz'));
    this.metadataPath = this.modelPath.replace(/\.npz$/i, '.json');
    if (!/\.npz$/i.test(this.modelPath) || !Number.isInteger(timeoutMs) || timeoutMs < 25 || timeoutMs > 120000) {
      throw new TypeError('A .npz model and a timeout between 25 and 120000 ms are required');
    }
    this.timeoutMs = timeoutMs;
  }

  status() {
    const base = { available: false, busy: activeExperiment, model: MODEL_LABEL };
    if (!isFile(this.pythonPath)) return { ...base, reason: '本地神经实验 Python 环境不可用。' };
    if (!isFile(this.modelPath) || !isFile(this.metadataPath)) return { ...base, reason: '本地神经子网模型或指纹文件不可用。' };
    if (!isFile(SCRIPT)) return { ...base, reason: '本地神经实验入口不可用。' };
    return { ...base, available: true, ...(activeExperiment ? { reason: '已有一个神经实验正在运行。' } : {}) };
  }

  async run(request) {
    validateRequest(request);
    if (activeExperiment) throw new NeuralResearchError('神经实验正在进行，请稍后再试。', 429, 'research_busy');
    const status = this.status();
    if (!status.available) throw new NeuralResearchError(status.reason);
    const stableRequest = { stimulus: request.stimulus, intensity: request.intensity, seed: request.seed };
    activeExperiment = true;
    try {
      const raw = await this.#execute(stableRequest);
      let result;
      try { result = JSON.parse(raw); }
      catch { throw new NeuralResearchError('神经实验返回格式无效，本次未产生研究结果。', 502, 'invalid_neural_response'); }
      return validateResult(result, stableRequest);
    } finally {
      activeExperiment = false;
    }
  }

  #execute(request) {
    return new Promise((resolve, reject) => {
      let settled = false, failure = null, outputLength = 0, errorLength = 0;
      const output = [], errors = [];
      const child = spawn(this.pythonPath, ['-B', '-X', 'utf8', SCRIPT, '--model', this.modelPath], {
        cwd: os.tmpdir(), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1', PYTHONUTF8: '1' }
      });
      const finish = (error, data) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stdin.destroy();
        if (error) reject(error); else resolve(data);
      };
      const abort = error => {
        if (!failure) failure = error;
        child.kill('SIGKILL');
      };
      const timer = setTimeout(() => abort(new NeuralResearchError('神经实验超时，本次未产生研究结果。', 504, 'research_timeout')), this.timeoutMs);
      child.on('error', error => {
        const unavailable = new NeuralResearchError('无法启动本地神经实验。', 503, 'research_spawn_failed');
        unavailable.cause = error;
        finish(unavailable);
      });
      child.stdout.on('data', chunk => {
        outputLength += chunk.length;
        if (outputLength > MAX_OUTPUT_BYTES) abort(new NeuralResearchError('神经实验输出超出上限，本次未产生研究结果。', 502, 'research_output_limit'));
        else output.push(chunk);
      });
      child.stderr.on('data', chunk => {
        errorLength += chunk.length;
        if (errorLength > MAX_ERROR_BYTES) abort(new NeuralResearchError('神经实验错误输出超出上限。', 502, 'research_output_limit'));
        else errors.push(chunk);
      });
      child.stdin.on('error', error => {
        if (!settled && !failure && error.code !== 'EPIPE') abort(new NeuralResearchError('无法向神经实验传入刺激。', 503, 'research_input_failed'));
      });
      child.on('close', code => {
        if (failure) return finish(failure);
        if (code !== 0) {
          const error = new NeuralResearchError('神经实验未完成，本次未产生研究结果。', 503, 'research_process_failed');
          error.diagnostic = Buffer.concat(errors).toString('utf8').slice(-4000);
          return finish(error);
        }
        finish(null, Buffer.concat(output).toString('utf8'));
      });
      child.stdin.end(JSON.stringify(request));
    });
  }
}
