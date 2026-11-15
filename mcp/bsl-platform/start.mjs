#!/usr/bin/env node
// MCP-сервер справки платформы 1С (синтаксис-помощник) для записи bsl-platform в
// MCP-конфиге харнесса: скачивает закреплённую версию alkoleft/mcp-bsl-platform-context в
// кэш пользователя и запускает её по stdio со справкой установленной платформы.
// Каталог платформы — переменная ONEC_PLATFORM_PATH. Нужна Java 17+ (JAVA_HOME или java в PATH).
// stdout принадлежит протоколу MCP: всё своё скрипт пишет в stderr.
// Проверка без харнесса — node start.mjs --check: скачать, найти Java и справку, выйти.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const VERSION = '0.3.2';
const JAR = `mcp-bsl-context-${VERSION}.jar`;
const URL = `https://github.com/alkoleft/mcp-bsl-platform-context/releases/download/v${VERSION}/${JAR}`;
// sha256 ассета релиза v0.3.2 — из GitHub API релиза (поле digest).
const SHA256 = '5c73a00077d051300384d51cbc8d43d36948348b59afcaa0dc1ccd1b94ef371e';
const JAVA_MIN = 17;

function fail(message) {
  process.stderr.write(`bsl-platform: ${message}\n`);
  process.exit(1);
}

function cacheDir() {
  const base = process.env.LOCALAPPDATA || process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(base, '1c-agent-skills', 'bsl-platform', VERSION);
}

async function ensureJar(dir) {
  const target = join(dir, JAR);
  if (existsSync(target)) return target;
  mkdirSync(dir, { recursive: true });
  process.stderr.write(`bsl-platform: скачиваю ${URL} (один раз, в ${dir})\n`);
  const response = await fetch(URL, { redirect: 'follow' });
  if (!response.ok || !response.body) fail(`не скачать ${URL}: HTTP ${response.status}`);
  const partial = `${target}.part`;
  const hash = createHash('sha256');
  const body = Readable.fromWeb(response.body);
  body.on('data', (chunk) => hash.update(chunk));
  await pipeline(body, createWriteStream(partial));
  const digest = hash.digest('hex');
  if (digest !== SHA256) {
    rmSync(partial, { force: true });
    fail(`sha256 ${JAR} не совпал: ${digest}, ожидался ${SHA256}`);
  }
  renameSync(partial, target);
  return target;
}

function findJava() {
  const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
  const run = spawnSync(java, ['-version'], { encoding: 'utf8' });
  const m = /version "(\d+)(?:\.(\d+))?/.exec(`${run.stderr ?? ''}${run.stdout ?? ''}`);
  const major = m ? (m[1] === '1' ? Number(m[2]) : Number(m[1])) : 0;
  if (run.error || run.status !== 0 || major < JAVA_MIN) {
    fail(`нужна Java ${JAVA_MIN}+ (${java}: ${major ? `версия ${major}` : 'не найдена'}); установите JDK или задайте JAVA_HOME в записи MCP`);
  }
  return java;
}

// Сервер ищет файлы справки shcntx_*.hbk обходом каталога; без них он стартует,
// но на каждый запрос отвечает пусто — проверяем заранее, чтобы ошибка была понятной.
function hasHelp(dir, depth = 0) {
  if (depth > 4) return false;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  return entries.some((e) => (e.isFile() && /^shcntx_.*\.hbk$/i.test(e.name))
    || (e.isDirectory() && hasHelp(join(dir, e.name), depth + 1)));
}

const platformPath = process.env.ONEC_PLATFORM_PATH;
if (!platformPath) fail('не задан ONEC_PLATFORM_PATH — каталог установленной платформы, например /opt/1cv8/x86_64/8.3.27.1606 или C:\\Program Files\\1cv8\\8.3.27.1606');
if (!hasHelp(platformPath)) fail(`в ${platformPath} нет файлов справки shcntx_*.hbk — нужен каталог версии платформы, а не корень 1cv8`);

const dir = cacheDir();
const jar = await ensureJar(dir);
const java = findJava();
if (process.argv.includes('--check')) {
  process.stderr.write(`bsl-platform: готово — ${jar}, ${java}, справка в ${platformPath}\n`);
  process.exit(0);
}

const child = spawn(java, [
  '-Dfile.encoding=UTF-8',
  // Логгеры сервера стоят на DEBUG и без LOG_FILE пишут в текущий каталог (проект).
  '-Dlogging.level.ru.alkoleft.context=INFO', '-Dlogging.level.org.springframework.cache=INFO',
  '-jar', jar, '--platform-path', platformPath,
], { stdio: 'inherit', env: { ...process.env, LOG_FILE: join(dir, 'mcp-server.log') } });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
