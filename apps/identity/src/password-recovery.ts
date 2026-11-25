/** Keycloak's user-initiated password reset action token. Other action timers stay independent. */
export const passwordResetAttributes = {
  'actionTokenGeneratedByUserLifespan.reset-credentials': '900',
} as const;
