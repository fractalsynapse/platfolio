// Re-exported so kernel tests exercise the *real* provider over the same mock the contracts use,
// rather than a second, softer double that could drift from it.
export { samplePlan } from '@platfolio/contracts';
export { RailwayMock } from '../../../packages/contracts/test/railway-mock.ts';
