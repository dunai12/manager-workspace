import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

const cargoName = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const canRun = path => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const env = { ...process.env };
const pathEntries = (env.PATH ?? '').split(delimiter);
const foundInPath = pathEntries.some(entry => canRun(join(entry, cargoName)));

if (!foundInPath) {
  const candidates = [env.CARGO_HOME, join(homedir(), '.cargo')].filter(Boolean);
  const cargoDir = candidates.map(dir => join(dir, 'bin')).find(dir => canRun(join(dir, cargoName)));
  if (!cargoDir) {
    console.error('Rust/Cargo не найден. Установите Rust через https://rustup.rs/ и повторите команду.');
    process.exit(1);
  }
  env.PATH = [cargoDir, env.PATH].filter(Boolean).join(delimiter);
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Не указана команда для запуска.');
  process.exit(1);
}

const child = spawn(command, args, { env, stdio: 'inherit', shell: process.platform === 'win32' });
child.on('error', error => {
  console.error(`Не удалось запустить ${command}: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = signal ? 130 : (code ?? 1);
});
