import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isReleaseTag } from '../apps/control-plane/src/release-tag.ts';

interface CandidateImage {
  image: string;
  digest: string;
}

export interface ReleaseCandidate {
  schemaVersion: 1;
  sourceCommit: string;
  runId: string;
  runAttempt: string;
  images: Record<string, CandidateImage>;
}

const commitSha = /^[0-9a-f]{40}$/;
const runNumber = /^[1-9][0-9]*$/;
const taggedImage = /^ghcr\.io\/[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+:sha-[0-9a-f]{40}$/;
const digest = /^sha256:[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseReleaseCandidate(input: unknown): ReleaseCandidate {
  if (!isRecord(input) || input.schemaVersion !== 1 ||
    typeof input.sourceCommit !== 'string' || !commitSha.test(input.sourceCommit) ||
    typeof input.runId !== 'string' || !runNumber.test(input.runId) ||
    typeof input.runAttempt !== 'string' || !runNumber.test(input.runAttempt) ||
    !isRecord(input.images) || Object.keys(input.images).length === 0) {
    throw new Error('Release candidate needs schemaVersion 1, a full sourceCommit, runId, runAttempt, and published images');
  }

  const images: Record<string, CandidateImage> = Object.create(null);
  for (const [service, entry] of Object.entries(input.images)) {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(service) || !isRecord(entry) ||
      typeof entry.image !== 'string' || !taggedImage.test(entry.image) || !entry.image.endsWith(`:sha-${input.sourceCommit}`) ||
      typeof entry.digest !== 'string' || !digest.test(entry.digest)) {
      throw new Error(`Invalid candidate image for ${JSON.stringify(service)}: expected a GHCR image tagged for the source commit and a sha256 digest`);
    }
    images[service] = { image: entry.image, digest: entry.digest };
  }
  return { schemaVersion: 1, sourceCommit: input.sourceCommit, runId: input.runId, runAttempt: input.runAttempt, images };
}

export function readReleaseCandidate(path: string): ReleaseCandidate {
  return parseReleaseCandidate(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

export function candidateArtifactResolver(candidate: ReleaseCandidate, checkoutCommit: string): (service: string) => string {
  if (candidate.sourceCommit !== checkoutCommit) {
    throw new Error(`Release candidate was built from ${candidate.sourceCommit}, but this checkout is ${checkoutCommit}`);
  }
  return (service) => {
    const image = Object.hasOwn(candidate.images, service) ? candidate.images[service] : undefined;
    if (!image) throw new Error(`Release candidate has no published image for service "${service}"`);
    return `${image.image}@${image.digest}`;
  };
}

function requireCandidateReleaseTag(tag: string, sourceCommit: string, cwd: string): string {
  if (!isReleaseTag(tag)) throw new Error('The candidate release tag must be a bare SemVer tag');
  let taggedCommit: string;
  try {
    taggedCommit = execFileSync('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error(`Release tag ${tag} does not resolve to a commit in this checkout. Fetch the tag before planning.`);
  }
  if (taggedCommit !== sourceCommit) {
    throw new Error(`Release tag ${tag} points to ${taggedCommit}, but the candidate was built from ${sourceCommit}`);
  }
  return tag;
}

export function resolveCheckoutCandidate(path: string, cwd: string, releaseTag?: string) {
  const candidate = readReleaseCandidate(path);
  const git = (args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const resolveArtifact = candidateArtifactResolver(candidate, git(['rev-parse', 'HEAD']));
  if (git(['status', '--porcelain', '--untracked-files=no'])) {
    throw new Error('Check out the candidate commit with a clean tracked tree before planning a release candidate');
  }
  return {
    sourceCommit: candidate.sourceCommit,
    resolveArtifact,
    releaseTag: releaseTag === undefined ? null : requireCandidateReleaseTag(releaseTag, candidate.sourceCommit, cwd),
  };
}
