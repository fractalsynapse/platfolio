/*
 * The runtime endpoint overlay, committed as an empty file on purpose.
 *
 * A static build bakes the island's props, so a deployment that must point one artifact at several environments
 * replaces this file at container start: `apps/site/Dockerfile` runs `apps/site/src/tools/render-runtime-config.ts`, which writes the
 * four names it finds in the environment into `dist/config.js`. What is tracked here is a comment and nothing
 * else — no origin, no issuer, no client id — because a value in this file would be a hostname in tracked source
 * (D47), and `check-project.ts`'s endpoint rule is the thing that would notice.
 *
 * An island that finds no `__PLATFOLIO_SITE_CONFIG__` uses what the build baked; that is the normal state of a
 * single-environment deployment, not a failure. `apps/site/src/lib/site-config.ts` owns the global's name,
 * `apps/site/test/site-config.test.ts` compares the three spellings (this file, the constant, the renderer), and
 * the renderer refuses to print a key that is not one of the four.
 */
