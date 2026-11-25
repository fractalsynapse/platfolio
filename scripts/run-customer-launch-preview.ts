import { parseArgs } from 'node:util';
import { boot, configFromEnv } from '../apps/control-plane/src/index.ts';
import { customerLaunchRun } from './customer-launch-run.ts';

const { values } = parseArgs({ options: { team: { type: 'string' }, journal: { type: 'string' } } });
if (!values.team || !values.journal) throw new Error('Pass a private --journal path and the connected owner --team ID');
const config = configFromEnv(process.env);
if (!['127.0.0.1', 'localhost'].includes(config.host)) throw new Error('The connected pilot API must bind to loopback');
const running = await boot({ ...config, starterLaunch: customerLaunchRun(values.team, values.journal) });
console.log(`Customer launch preview is running on ${config.host}:${config.port}`);
process.on('SIGTERM', () => { void running.stop().then(() => process.exit(0)); });
