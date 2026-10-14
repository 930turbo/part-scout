import { mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
const folder = resolve('.preview/browser');
mkdirSync(folder, { recursive: true });
for (const name of ['demo.db', 'demo.db-wal', 'demo.db-shm'])
  rmSync(join(folder, name), { force: true });
const env = {
  ...process.env,
  DATABASE_PATH: join(folder, 'demo.db'),
  PORT: '4311',
  HOST: '127.0.0.1',
  ADMIN_TOKEN: '',
  DISCORD_WEBHOOK_URL: '',
  CAR_PART_ENABLED: 'false',
};
const seed = spawnSync(process.execPath, ['--import', 'tsx', 'src/demo.ts'], {
  env,
  stdio: 'inherit',
});
if (seed.status !== 0) process.exit(seed.status || 1);
const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
  env,
  stdio: 'inherit',
});
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
child.on('exit', (code) => process.exit(code || 0));
