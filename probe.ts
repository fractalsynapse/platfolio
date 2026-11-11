import { Context } from 'cordis';
import { IdentityService } from './packages/kernel/src/identity.ts';
import { requireServices } from './packages/kernel/src/startup.ts';
import { createIdentityFixture, defaultIdentityConfig } from './packages/contracts/src/index.ts';
const fixture = createIdentityFixture();
const log = (m: string) => { process.stdout.write(`P ${m}\n`); };
log('start');
const ctx = new Context();
try { await ctx.plugin(IdentityService, defaultIdentityConfig(fixture)); log(`plugin ok; identity=${typeof ctx.identity}`); }
catch (e) { log(`plugin THREW: ${(e as Error).message.slice(0,240)}`); }
try { await requireServices(ctx, ['identity'], { timeoutMs: 1000 }); log('require identity resolved'); }
catch (e) { log(`require identity REJECTED: ${(e as Error).message.slice(0,240).replace(/\n/g,' | ')}`); }
process.exit(0);
