#!/usr/bin/env node
// Проверка кода 1С BSL Language Server: скачивает закреплённую версию в кэш пользователя,
// анализирует каталоги исходников, печатает замечания и возвращает код:
// 0 — нет замечаний уровня --fail-on и выше, 1 — есть, 2 — ошибка вызова или запуска.
// Запуск и опции — node bsl-check.mjs --help.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const VERSION = '1.0.7';
const RELEASE = `https://github.com/1c-syntax/bsl-language-server/releases/download/v${VERSION}`;
// sha256 ассетов релиза v1.0.7 — из GitHub API релиза (поле digest).
const ASSETS = {
  jar: { name: `bsl-language-server-${VERSION}-exec.jar`, sha256: '9f62765edd344d66456da24c906eaf623a03c56e90e5aafee466200100909f64' },
  win32: { name: 'bsl-language-server_win.zip', sha256: 'fed523e3b6d1d64c65a0df08ff74088c4d26eb3c550a2ff776c84ac2c8655c30' },
  linux: { name: 'bsl-language-server_nix.zip', sha256: 'af6ba0184e284aa866745b074510e001bae67c07cfe41e533b99f3cb5e71304e' },
  darwin: { name: 'bsl-language-server_mac.zip', sha256: 'c889da055738204817a140fae3e68429fae839060c6b5edcc3da4fe7a5eff53c' },
};
const LEVELS = ['error', 'warning', 'information', 'hint'];
const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_CONFIG = join(SKILL_DIR, 'bsl-language-server.json');

const HELP = `Использование:
  node bsl-check.mjs --src <каталог> [--src <каталог> ...] [опции]

Опции:
  --src <каталог>       каталог исходников: расширение или конфигурация в XML; можно несколько
  --config <файл>       настройки BSL LS; по умолчанию .bsl-language-server.json текущего
                        каталога, иначе настройки скилла
  --out <каталог>       куда писать отчёты; по умолчанию logs/bsl
  --changed <ревизия>   показывать замечания только в файлах, изменённых относительно ревизии
                        git (и новых неотслеживаемых), например main или HEAD
  --fail-on <уровень>   error (по умолчанию), warning, information или hint: с какого уровня
                        замечания дают код 1
  --bsl-ls <путь>       свой BSL LS: .jar (нужна Java 17+) или исполняемый файл;
                        то же — переменная BSL_LANGUAGE_SERVER
  --help                эта справка

Коды: 0 — замечаний уровня --fail-on и выше нет, 1 — есть, 2 — ошибка вызова или запуска.`;

function fail(message) {
  process.stderr.write(`Ошибка: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = { src: [], out: 'logs/bsl', failOn: 'error' };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) fail(`у ${key} нет значения`);
      i += 1;
      return v;
    };
    if (key === '--help' || key === '-h') { process.stdout.write(`${HELP}\n`); process.exit(0); }
    else if (key === '--src') args.src.push(value());
    else if (key === '--config') args.config = value();
    else if (key === '--out') args.out = value();
    else if (key === '--changed') args.changed = value();
    else if (key === '--fail-on') args.failOn = value().toLowerCase();
    else if (key === '--bsl-ls') args.bslLs = value();
    else fail(`неизвестная опция ${key}; справка — --help`);
  }
  if (args.src.length === 0) fail('нужен хотя бы один --src');
  if (!LEVELS.includes(args.failOn)) fail(`--fail-on: одно из ${LEVELS.join(', ')}`);
  return args;
}

function cacheRoot() {
  const base = process.env.LOCALAPPDATA || process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(base, '1c-agent-skills', 'bsl-language-server', VERSION);
}

function javaMajor() {
  const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
  const run = spawnSync(java, ['-version'], { encoding: 'utf8' });
  if (run.error || run.status !== 0) return { java, major: 0 };
  const m = /version "(\d+)(?:\.(\d+))?/.exec(`${run.stderr}${run.stdout}`);
  if (!m) return { java, major: 0 };
  const major = m[1] === '1' ? Number(m[2]) : Number(m[1]);
  return { java, major };
}

async function download(asset, target) {
  if (existsSync(target)) return;
  mkdirSync(dirname(target), { recursive: true });
  const url = `${RELEASE}/${asset.name}`;
  process.stderr.write(`Скачиваю ${url} (один раз, в ${dirname(target)})\n`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) fail(`не скачать ${url}: HTTP ${response.status}`);
  const partial = `${target}.part`;
  const hash = createHash('sha256');
  const body = Readable.fromWeb(response.body);
  body.on('data', (chunk) => hash.update(chunk));
  await pipeline(body, createWriteStream(partial));
  const digest = hash.digest('hex');
  if (digest !== asset.sha256) {
    rmSync(partial, { force: true });
    fail(`sha256 ${asset.name} не совпал: ${digest}, ожидался ${asset.sha256}`);
  }
  renameSync(partial, target);
}

function unzip(zip, dir) {
  mkdirSync(dir, { recursive: true });
  const tries = platform() === 'linux'
    ? [['unzip', ['-q', '-o', zip, '-d', dir]], ['python3', ['-I', '-m', 'zipfile', '-e', zip, dir]], ['bsdtar', ['-xf', zip, '-C', dir]]]
    : [['tar', ['-xf', zip, '-C', dir]]];
  for (const [cmd, cmdArgs] of tries) {
    const run = spawnSync(cmd, cmdArgs, { stdio: 'ignore' });
    if (!run.error && run.status === 0) {
      restoreExecutable(dir);
      return;
    }
  }
  fail(`не распаковать ${zip}: нужен ${tries.map(([c]) => c).join(' или ')}`);
}

// unzip из Python и часть других распаковщиков теряют права: лаунчер и Java сборки
// остаются без флага исполнения. Возвращаем его файлам в bin/, MacOS/ и jspawnhelper.
function restoreExecutable(dir) {
  if (platform() === 'win32') return;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (['bin', 'MacOS'].includes(basename(current)) || entry.name === 'jspawnhelper') {
        chmodSync(path, statSync(path).mode | 0o755);
      }
    }
  }
}

function findLauncher(dir) {
  const names = platform() === 'win32' ? ['bsl-language-server.exe'] : ['bsl-language-server'];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (names.includes(entry.name) && (platform() === 'win32' || ['bin', 'MacOS'].includes(basename(current)))) return path;
    }
  }
  return undefined;
}

async function resolveServer(explicit) {
  const given = explicit || process.env.BSL_LANGUAGE_SERVER;
  const { java, major } = javaMajor();
  if (given) {
    if (!existsSync(given)) fail(`BSL LS не найден: ${given}`);
    if (given.endsWith('.jar')) {
      if (major < 17) fail('для .jar нужна Java 17+ в PATH или JAVA_HOME');
      return { cmd: java, prefix: ['-jar', given] };
    }
    return { cmd: given, prefix: [] };
  }
  const cache = cacheRoot();
  if (major >= 17) {
    const jar = join(cache, ASSETS.jar.name);
    await download(ASSETS.jar, jar);
    return { cmd: java, prefix: ['-jar', jar] };
  }
  const asset = ASSETS[platform()];
  if (!asset) fail(`нет сборки BSL LS для ${platform()}; поставьте Java 17+`);
  const imageDir = join(cache, 'image');
  let launcher = existsSync(imageDir) ? findLauncher(imageDir) : undefined;
  if (launcher) restoreExecutable(imageDir);
  if (!launcher) {
    const zip = join(cache, asset.name);
    await download(asset, zip);
    rmSync(imageDir, { recursive: true, force: true });
    unzip(zip, imageDir);
    launcher = findLauncher(imageDir);
    if (!launcher) fail(`в ${asset.name} нет исполняемого bsl-language-server`);
  }
  return { cmd: launcher, prefix: [] };
}

function changedFiles(rev) {
  const git = (gitArgs) => {
    const run = spawnSync('git', ['-c', 'core.quotepath=off', ...gitArgs], { encoding: 'utf8' });
    if (run.error || run.status !== 0) fail(`git ${gitArgs.join(' ')}: ${run.stderr || run.error}`);
    return run.stdout;
  };
  const root = git(['rev-parse', '--show-toplevel']).trim();
  const names = `${git(['diff', '--name-only', '-z', rev])}\0${git(['ls-files', '-z', '--others', '--exclude-standard'])}`;
  return new Set(names.split('\0').filter(Boolean).map((name) => normalize(resolve(root, name))));
}

function normalize(path) {
  const p = resolve(path);
  return platform() === 'win32' ? p.toLowerCase() : p;
}

function readReport(file) {
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  return JSON.parse(text);
}

const args = parseArgs(process.argv.slice(2));
const config = args.config ?? (existsSync('.bsl-language-server.json') ? '.bsl-language-server.json' : DEFAULT_CONFIG);
if (!existsSync(config)) fail(`нет файла настроек ${config}`);
const server = await resolveServer(args.bslLs);
const changed = args.changed ? changedFiles(args.changed) : undefined;
const failRank = LEVELS.indexOf(args.failOn);

const issues = [];
let files = 0;
for (const src of args.src) {
  const srcDir = resolve(src);
  if (!existsSync(srcDir)) fail(`нет каталога ${src}`);
  const out = resolve(args.out, basename(srcDir));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const run = spawnSync(server.cmd, [...server.prefix, '--analyze', '--srcDir', srcDir,
    '--reporter', 'json', '--outputDir', out, '--configuration', resolve(config), '--silent'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const report = readReport(join(out, 'bsl-json.json'));
  if (run.error || !report) {
    fail(`BSL LS не построил отчёт для ${src} (код ${run.status}): ${(run.stderr || String(run.error ?? '')).trim().slice(-2000)}`);
  }
  for (const info of report.fileinfos ?? []) {
    const path = fileURLToPath(info.path);
    if (changed && !changed.has(normalize(path))) continue;
    files += 1;
    for (const d of info.diagnostics ?? []) {
      issues.push({
        path,
        line: d.range.start.line + 1,
        column: d.range.start.character + 1,
        level: String(d.severity).toLowerCase(),
        code: d.code,
        message: d.message,
      });
    }
  }
  process.stderr.write(`Отчёт: ${join(out, 'bsl-json.json')}\n`);
}

issues.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level)
  || a.path.localeCompare(b.path) || a.line - b.line);
const cwd = process.cwd() + sep;
for (const i of issues) {
  const shown = i.path.startsWith(cwd) ? i.path.slice(cwd.length) : i.path;
  process.stdout.write(`${shown}:${i.line}:${i.column}: ${i.level} ${i.code}: ${i.message}\n`);
}
const counts = LEVELS.map((level) => `${level} ${issues.filter((i) => i.level === level).length}`).join(', ');
const failing = issues.filter((i) => LEVELS.indexOf(i.level) <= failRank).length;
process.stdout.write(`Итог: файлов ${files}${changed ? ` (изменённых относительно ${args.changed})` : ''}; ${counts}; `
  + `${failing === 0 ? `замечаний уровня ${args.failOn} и выше нет` : `замечаний уровня ${args.failOn} и выше: ${failing}`}\n`);
process.exit(failing === 0 ? 0 : 1);
