package dev.platfolio.identity;

import java.io.IOException;
import java.util.List;
import java.util.Map;

import org.jboss.logging.Logger;
import org.keycloak.Config;
import org.keycloak.events.Event;
import org.keycloak.events.EventListenerProvider;
import org.keycloak.events.EventListenerProviderFactory;
import org.keycloak.events.admin.AdminEvent;
import org.keycloak.models.ClientModel;
import org.keycloak.models.UserModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.models.ProtocolMapperModel;
import org.keycloak.models.RealmModel;
import org.keycloak.models.RoleModel;
import org.keycloak.models.dblock.DBLockManager;
import org.keycloak.models.dblock.DBLockProvider;
import org.keycloak.models.utils.KeycloakModelUtils;
import org.keycloak.models.utils.PostMigrationEvent;
import org.keycloak.representations.idm.ProtocolMapperRepresentation;
import org.keycloak.representations.userprofile.config.UPAttribute;
import org.keycloak.storage.UserStoragePrivateUtil;
import org.keycloak.storage.UserStorageUtil;
import org.keycloak.userprofile.UserProfileProvider;
import org.keycloak.util.JsonSerialization;

public final class OperatorProfileMigration implements EventListenerProviderFactory {
    private static final Logger LOG = Logger.getLogger(OperatorProfileMigration.class);
    private static final String REALM = "platfolio";
    private static final String MIGRATION = "platfolio.operatorProfile";
    private static final int VERSION = 2;
    private boolean migrate;

    public record Policy(String apiClientId, String apiRole, String webClientId, String accountClientId,
            String accountRole, ProtocolMapperRepresentation apiScope,
            List<ProtocolMapperRepresentation> accountMappers, UPAttribute displayName, UPAttribute avatar) {}

    @Override
    public String getId() {
        return "platfolio-operator-profile-migration";
    }

    @Override
    public void init(Config.Scope config) {
        migrate = config.getBoolean("migrate", false);
    }

    @Override
    public void close() {}

    @Override
    public EventListenerProvider create(KeycloakSession session) {
        return new EventListenerProvider() {
            @Override public void onEvent(Event event) {}
            @Override public void onEvent(AdminEvent event, boolean includeRepresentation) {}
            @Override public void close() {}
        };
    }

    @Override
    public void postInit(KeycloakSessionFactory factory) {
        if (!migrate) return;
        factory.register(event -> {
            if (event instanceof PostMigrationEvent) {
                var policy = readPolicy();
                // Hold the lock until the inner transaction commits, including its completion marker.
                try (var lockSession = factory.create()) {
                    var lock = new DBLockManager(lockSession).getDBLock();
                    lock.waitForLock(DBLockProvider.Namespace.KEYCLOAK_BOOT);
                    try {
                        var changed = KeycloakModelUtils.runJobInTransactionWithResult(factory,
                            session -> repair(session, policy));
                        if (changed) LOG.infof("Platfolio operator profile migration %d applied", VERSION);
                    } finally {
                        lock.releaseLock();
                    }
                }
            }
        });
    }

    private static Policy readPolicy() {
        try (var input = OperatorProfileMigration.class.getResourceAsStream("/platfolio-operator-profile.json")) {
            if (input == null) throw new IllegalStateException("Platfolio operator profile policy is missing");
            return JsonSerialization.readValue(input, Policy.class);
        } catch (IOException error) {
            throw new IllegalStateException("Platfolio operator profile policy could not be read", error);
        }
    }

    private static boolean repair(KeycloakSession session, Policy policy) {
        RealmModel realm = session.realms().getRealmByName(REALM);
        if (realm == null) throw new IllegalStateException("Platfolio operator realm is missing");
        session.getContext().setRealm(realm);
        ClientModel api = realm.getClientByClientId(policy.apiClientId());
        ClientModel web = realm.getClientByClientId(policy.webClientId());
        ClientModel account = realm.getClientByClientId(policy.accountClientId());
        RoleModel operator = api == null ? null : api.getRole(policy.apiRole());
        RoleModel selfService = account == null ? null : account.getRole(policy.accountRole());
        if (web == null || !web.isPublicClient() || !"openid-connect".equals(web.getProtocol())
                || operator == null || selfService == null) {
            throw new IllegalStateException("Platfolio operator realm lacks its profile clients or roles");
        }

        var provider = session.getProvider(UserProfileProvider.class);
        applyDeploymentPolicy(realm, provider, operator, selfService);
        if (realm.getAttribute(MIGRATION, 0) >= VERSION) return false;

        var desiredScope = policy.apiScope();
        var scope = web.getProtocolMapperByName(desiredScope.getProtocol(), desiredScope.getName());
        if (scope == null || !desiredScope.getProtocolMapper().equals(scope.getProtocolMapper())
                || !"scope".equals(scope.getConfig().get("claim.name"))
                || !policy.apiClientId().equals(scope.getConfig().get("usermodel.clientRoleMapping.clientId"))) {
            throw new IllegalStateException("Platfolio browser scope mapper differs from the upgrade policy");
        }
        if (!"false".equals(scope.getConfig().get("multivalued"))) {
            scope.getConfig().put("multivalued", "false");
            web.updateProtocolMapper(scope);
        }

        var profile = provider.getConfiguration();
        if (profile.getAttribute(policy.displayName().getName()) == null) {
            var defaultProfile = realm.getComponentsStream(realm.getId(), UserProfileProvider.class.getName())
                .findAny().isEmpty();
            profile = profile.addOrReplaceAttribute(policy.displayName());
            provider.setConfiguration(profile);
            if (defaultProfile) realm.setEditUsernameAllowed(true);
        }
        if (profile.getAttribute(policy.avatar().getName()) == null) {
            provider.setConfiguration(profile.addOrReplaceAttribute(policy.avatar()));
        }
        for (var desired : policy.accountMappers()) addAccountMapper(web, desired);
        if (web.getScopeMappingsStream().noneMatch(selfService::equals)) web.addScopeMapping(selfService);

        var cache = UserStorageUtil.userCache(session);
        try (var users = UserStoragePrivateUtil.userLocalStorage(session).searchForUserStream(realm, Map.of())) {
            users.filter(user -> user.getServiceAccountClientLink() == null
                    && user.getFederationLink() == null
                    && user.hasRole(operator) && !user.hasRole(selfService))
                .forEach(user -> {
                    user.grantRole(selfService);
                    if (cache != null) cache.evict(realm, user);
                });
        }
        realm.setAttribute(MIGRATION, Integer.toString(VERSION));
        return true;
    }

    private static void applyDeploymentPolicy(RealmModel realm, UserProfileProvider provider, RoleModel operator, RoleModel account) {
        String policy = System.getenv("PLATFOLIO_ACCOUNT_POLICY");
        if (policy == null || policy.isBlank()) return;
        if (!"public".equals(policy) && !"managed".equals(policy)) {
            throw new IllegalStateException("PLATFOLIO_ACCOUNT_POLICY must be public or managed");
        }
        boolean open = "public".equals(policy);
        realm.setAttribute(OperatorEmailResource.PUBLIC_POLICY, Boolean.toString(open));
        applyMailRelay(realm);
        var configuration = provider.getConfiguration();
        var email = configuration.getAttribute(UserModel.EMAIL);
        if (email == null) throw new IllegalStateException("The operator profile has no email attribute");
        if (!email.getValidations().containsKey(OperatorEmailUniqueness.ID)) {
            email.getValidations().put(OperatorEmailUniqueness.ID, Map.of());
            provider.setConfiguration(configuration);
        }
        boolean mailConfigured = !realm.getSmtpConfig().getOrDefault("host", "").isBlank();
        realm.setRegistrationAllowed(open && mailConfigured);
        // New registrations must verify, while upgrades leave existing unverified operators able to sign in.
        var verification = realm.getRequiredActionProviderByAlias(UserModel.RequiredAction.VERIFY_EMAIL.name());
        if (verification != null && verification.isDefaultAction() != open) {
            verification.setDefaultAction(open);
            realm.updateRequiredActionProvider(verification);
        }
        if (open) {
            realm.setResetPasswordAllowed(mailConfigured);
            realm.setDuplicateEmailsAllowed(false);
            var defaults = realm.getDefaultRole();
            defaults.addCompositeRole(operator);
            defaults.addCompositeRole(account);
        }
    }

    private static void applyMailRelay(RealmModel realm) {
        var environment = System.getenv();
        var host = environment.get("PLATFOLIO_SMTP_HOST");
        if (host == null || host.isBlank()) return;
        var port = environment.get("PLATFOLIO_SMTP_PORT");
        var sender = environment.get("PLATFOLIO_EMAIL_FROM");
        var user = environment.get("PLATFOLIO_SMTP_USER");
        var password = environment.get("PLATFOLIO_SMTP_PASSWORD");
        if (port == null || !port.matches("[0-9]{1,5}") || Integer.parseInt(port) < 1 || Integer.parseInt(port) > 65535
                || sender == null || sender.isBlank() || user == null || user.isBlank() || password == null || password.isBlank()) {
            throw new IllegalStateException("The operator mail relay needs a valid port, sender and credentials");
        }
        boolean tls = "465".equals(port) || "true".equals(environment.get("PLATFOLIO_SMTP_SECURE"));
        realm.setSmtpConfig(Map.of("host", host, "port", port, "from", sender, "fromDisplayName", "Platfolio",
            "auth", "true", "authType", "basic", "ssl", Boolean.toString(tls), "starttls", Boolean.toString(!tls),
            "user", user, "password", password));
        realm.setResetPasswordAllowed(true);
    }

    private static void addAccountMapper(ClientModel web, ProtocolMapperRepresentation desired) {
        var existing = web.getProtocolMapperByName(desired.getProtocol(), desired.getName());
        if (existing != null) {
            if (!desired.getProtocolMapper().equals(existing.getProtocolMapper())
                    || !existing.getConfig().entrySet().containsAll(desired.getConfig().entrySet())) {
                throw new IllegalStateException("Platfolio account mapper differs from the upgrade policy");
            }
            return;
        }
        var mapper = new ProtocolMapperModel();
        mapper.setName(desired.getName());
        mapper.setProtocol(desired.getProtocol());
        mapper.setProtocolMapper(desired.getProtocolMapper());
        mapper.setConfig(desired.getConfig());
        web.addProtocolMapper(mapper);
    }
}
