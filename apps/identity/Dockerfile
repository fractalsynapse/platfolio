FROM node:22-bookworm-slim AS private-realm
WORKDIR /build
COPY package.json ./
COPY apps/identity/src/ ./apps/identity/src/
COPY scripts/keycloak-browser-client.ts ./scripts/
COPY packages/ui/src/web/browser-auth-policy.ts packages/ui/src/web/installation-owner-policy.ts ./packages/ui/src/web/
RUN mkdir /realm \
    && for owner in '' '-with-verifier'; do \
         for mail in '' '-with-mail'; do \
           node --experimental-strip-types --disable-warning=ExperimentalWarning apps/identity/src/private-operator-realm.ts \
             ${owner:+--owner-verifier} ${mail:+--password-recovery} > "/realm/platfolio-realm$owner$mail.json" || exit; \
         done; \
       done

FROM keycloak/keycloak:26.8.2@sha256:c126f032d43b941ed7c5ccca7d6571596d8eab84d748afd7c86989e48ef07b8f

# Platfolio owns the account UI. The account REST API is a separate Keycloak feature.
COPY --chown=1000:0 apps/identity/keycloak.conf /opt/keycloak/conf/keycloak.conf

COPY --chown=1000:0 apps/identity/themes/ /opt/keycloak/themes/
COPY --chown=1000:0 packages/ui/src/tokens.css packages/ui/src/components/components.css /opt/keycloak/themes/platfolio/login/resources/css/
COPY --from=private-realm --chown=1000:0 /realm/ /opt/keycloak/platfolio-private/
COPY --chmod=755 apps/identity/entrypoint.sh /opt/keycloak/bin/platfolio-entrypoint.sh
ENTRYPOINT ["/opt/keycloak/bin/platfolio-entrypoint.sh"]
