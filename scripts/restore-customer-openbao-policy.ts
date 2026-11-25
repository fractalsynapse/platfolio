import { readFile, stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { restoreOpenBaoLauncherPolicy } from './customer-openbao.ts';

const { values } = parseArgs({ options: { origin: { type: 'string' }, 'recovery-file': { type: 'string' } } });
const origin = values.origin;
const file = values['recovery-file'];
if (!origin || !file) throw new Error('Provide an installation-local OpenBao --origin and your private --recovery-file');
const mode = await stat(file);
if (!mode.isFile() || mode.mode & 0o077) throw new Error('Use a private file for OpenBao recovery');
const saved = await readFile(file, 'utf8');
let shares: unknown;
try { shares = (JSON.parse(saved) as { shares?: unknown })?.shares; }
catch { throw new Error('Use a valid OpenBao owner recovery file'); }
if (!Array.isArray(shares) || typeof shares[0] !== 'string' || typeof shares[1] !== 'string') throw new Error('The OpenBao owner recovery file needs two shares');
await restoreOpenBaoLauncherPolicy(origin, [shares[0], shares[1]]);
console.log('OpenBao verified the launcher policy and retired the temporary recovery token.');
