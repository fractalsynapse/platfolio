/** Bare SemVer under D19, with optional prerelease and build metadata. */
export function isReleaseTag(value: string): boolean {
  const match = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
  // Numeric prerelease identifiers cannot have leading zeroes. Build metadata may.
  return match?.[0] === value && !match[1]?.split('.').some((part) => /^0\d+$/.test(part));
}
