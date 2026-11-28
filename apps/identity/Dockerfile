FROM keycloak/keycloak:26.8.2@sha256:c126f032d43b941ed7c5ccca7d6571596d8eab84d748afd7c86989e48ef07b8f AS keycloak

FROM node:22-bookworm-slim AS private-realm
WORKDIR /build
COPY package.json ./
COPY apps/identity/src/ ./apps/identity/src/
COPY scripts/keycloak-browser-client.ts ./scripts/
COPY packages/ui/src/web/browser-auth-policy.ts packages/ui/src/web/installation-owner-policy.ts ./packages/ui/src/web/
RUN mkdir /realm \
    && node --experimental-strip-types --disable-warning=ExperimentalWarning apps/identity/src/operator-profile-migration.ts \
         > /realm/platfolio-operator-profile.json \
    && for owner in '' '-with-verifier'; do \
         for mail in '' '-with-mail'; do \
           for setup in '' '-with-setup'; do \
             node --experimental-strip-types --disable-warning=ExperimentalWarning apps/identity/src/private-operator-realm.ts \
               ${owner:+--owner-verifier} ${mail:+--password-recovery} ${setup:+--with-setup} > "/realm/platfolio-realm$owner$mail$setup.json" || exit; \
           done; \
         done; \
       done

FROM eclipse-temurin:21-jdk-jammy@sha256:b2711c65970c1227197c29c46e669bfdbb137524e9da0e664703a140ec25a040 AS provider
WORKDIR /build
COPY --from=keycloak /opt/keycloak/lib/lib/main /keycloak-libs
COPY --from=keycloak /opt/keycloak/lib/lib/boot /keycloak-boot
COPY --from=private-realm /realm/platfolio-operator-profile.json ./resources/
COPY apps/identity/providers/src/ ./src/
RUN mkdir classes \
    && javac --release 21 -cp '/keycloak-libs/*:/keycloak-boot/*' -d classes src/*.java \
    && jar --create --file /operator-profile.jar -C classes . -C src META-INF -C resources .

FROM keycloak

# Platfolio owns the account UI. The account REST API is a separate Keycloak feature.
COPY --chown=1000:0 apps/identity/keycloak.conf /opt/keycloak/conf/keycloak.conf

COPY --chown=1000:0 apps/identity/themes/ /opt/keycloak/themes/
COPY --chown=1000:0 packages/ui/src/tokens.css packages/ui/src/components/components.css /opt/keycloak/themes/platfolio/login/resources/css/
COPY --from=private-realm --chown=1000:0 /realm/ /opt/keycloak/platfolio-private/
COPY --from=provider --chown=1000:0 /operator-profile.jar /opt/keycloak/providers/
COPY --chmod=755 apps/identity/entrypoint.sh /opt/keycloak/bin/platfolio-entrypoint.sh
ENTRYPOINT ["/opt/keycloak/bin/platfolio-entrypoint.sh"]
