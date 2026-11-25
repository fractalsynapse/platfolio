FROM keycloak/keycloak:26.8.2@sha256:c126f032d43b941ed7c5ccca7d6571596d8eab84d748afd7c86989e48ef07b8f

# Platfolio owns the account UI. The account REST API is a separate Keycloak feature.
COPY --chown=1000:0 apps/identity/keycloak.conf /opt/keycloak/conf/keycloak.conf

COPY --chown=1000:0 apps/identity/themes/ /opt/keycloak/themes/
COPY --chown=1000:0 packages/ui/src/tokens.css packages/ui/src/components/components.css /opt/keycloak/themes/platfolio/login/resources/css/
