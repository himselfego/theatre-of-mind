#!/usr/bin/env node
// Копирует модуль на сервер Foundry по SSH (tar поверх ssh). Сборки у модуля нет.
//
//   npm run sync          — скопировать один раз
//   npm run sync:watch    — скопировать и дальше копировать после каждого изменения
//
// Флаги:
//   --manifest  копировать ещё и module.json (Foundry читает его только при запуске)
//   --clean     перед копированием удалить на сервере scripts, styles, templates и lang
//   --init      первая установка: создать папку модуля на сервере и скопировать module.json
//
// Без --init скрипт не создаёт папку модуля: если её нет, он остановится с ошибкой.
//
// Куда копировать: переменная TOM_SYNC_TARGET или файл .sync-target в корне проекта.
// Формат: user@host:/абсолютный/путь/к/модулю
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, watch } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SYNC_DIRS = ['scripts', 'styles', 'templates', 'lang'];
const DEBOUNCE_MS = 400;

const flags = new Set(process.argv.slice(2));
const isInit = flags.has('--init');
const isWithManifest = isInit || flags.has('--manifest');
const isClean = flags.has('--clean');
const isWatchMode = flags.has('--watch');

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const readTarget = () => {
  const fromEnv = process.env.TOM_SYNC_TARGET;

  if (fromEnv) {
    return fromEnv.trim();
  }

  const file = path.join(root, '.sync-target');

  return existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
};

const parseTarget = (target) => {
  const match = /^([^:\s]+):(\/[^'\s]+)$/.exec(target);

  if (!match) {
    fail('Не задана цель копирования. Нужна строка user@host:/путь в TOM_SYNC_TARGET или в файле .sync-target');
  }

  return { host: match[1], remotePath: match[2] };
};

// На Windows берём системный OpenSSH: только он видит агент 1Password.
const resolveSsh = () => {
  if (process.env.TOM_SYNC_SSH) {
    return process.env.TOM_SYNC_SSH;
  }

  if (process.platform === 'win32') {
    return path.join(process.env.SystemRoot ?? String.raw`C:\Windows`, 'System32', 'OpenSSH', 'ssh.exe');
  }

  return 'ssh';
};

const { host, remotePath } = parseTarget(readTarget());
const ssh = resolveSsh();

const sync = () => new Promise((resolve, reject) => {
  const items = isWithManifest ? [...SYNC_DIRS, 'module.json'] : SYNC_DIRS;
  const remoteSteps = [];

  if (isInit) {
    remoteSteps.push(`mkdir -p '${remotePath}'`);
  }
  remoteSteps.push(`cd '${remotePath}'`);
  if (isClean) {
    remoteSteps.push(`rm -rf ${SYNC_DIRS.join(' ')}`);
  }
  remoteSteps.push('tar -xf -');

  const tar = spawn('tar', ['-cf', '-', ...items], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
  const remote = spawn(ssh, ['-o', 'ConnectTimeout=10', host, remoteSteps.join(' && ')], {
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  const codes = {};
  const finish = (name, code) => {
    codes[name] = code;
    if (codes.tar === undefined || codes.remote === undefined) {
      return;
    }

    if (codes.tar === 0 && codes.remote === 0) {
      resolve();
    } else {
      reject(new Error(`Копирование не удалось (tar: ${codes.tar}, ssh: ${codes.remote})`));
    }
  };

  tar.on('error', reject);
  remote.on('error', reject);
  tar.on('close', code => finish('tar', code));
  remote.on('close', (code) => {
    // Если ssh упал, tar некому читать: без этого он завис бы навсегда.
    if (code !== 0) {
      tar.kill();
    }
    finish('remote', code);
  });
  // ssh мог завершиться раньше tar (например, на сервере нет папки): причина будет в его коде возврата.
  remote.stdin.on('error', (error) => {
    if (error.code !== 'EPIPE') {
      reject(error);
    }
  });
  tar.stdout.pipe(remote.stdin);
});

const syncOnce = async () => {
  const started = Date.now();

  await sync();
  console.log(`[sync] ${host}:${remotePath} — готово за ${((Date.now() - started) / 1000).toFixed(1)} с`);
};

const startWatching = () => {
  let timer = null;
  let isRunning = false;
  let isPending = false;

  const run = async () => {
    if (isRunning) {
      isPending = true;

      return;
    }

    isRunning = true;
    try {
      await syncOnce();
    } catch (error) {
      console.error(`[sync] ${error.message}`);
    }
    isRunning = false;

    if (isPending) {
      isPending = false;
      await run();
    }
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(run, DEBOUNCE_MS);
  };

  for (const directory of SYNC_DIRS) {
    watch(path.join(root, directory), { recursive: true }, schedule);
  }

  console.log(`[sync] слежу за ${SYNC_DIRS.join(', ')}; Ctrl+C — выход`);
  run();
};

if (isWatchMode) {
  startWatching();
} else {
  try {
    await syncOnce();
  } catch (error) {
    fail(`[sync] ${error.message}`);
  }
}
