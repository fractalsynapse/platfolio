package dev.platfolio.identity;

import java.util.List;
import java.util.Locale;

import jakarta.persistence.LockModeType;
import jakarta.ws.rs.core.Response;
import org.keycloak.connections.jpa.JpaConnectionProvider;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.models.jpa.entities.RealmEntity;
import org.keycloak.storage.UserStoragePrivateUtil;
import org.keycloak.userprofile.UserProfileAttributeValidationContext;
import org.keycloak.validate.SimpleValidator;
import org.keycloak.validate.ValidationContext;
import org.keycloak.validate.ValidationError;
import org.keycloak.validate.ValidatorConfig;

public final class OperatorEmailUniqueness implements SimpleValidator {
    static final String ID = "platfolio-unique-email";
    static final String SECONDARY = "platfolio.verifiedEmail";

    @Override public String getId() { return ID; }

    @Override
    public ValidationContext validate(Object input, String attribute, ValidationContext context, ValidatorConfig config) {
        if (!(input instanceof List<?> values) || values.isEmpty() || !(values.getFirst() instanceof String address)) return context;
        var session = context.getSession();
        var realm = session.getContext().getRealm();
        var user = UserProfileAttributeValidationContext.from(context).getAttributeContext().getUser();
        String normalized = normalize(address);
        if (normalized.isEmpty() || (user != null && normalized.equals(normalize(user.getEmail())))) return context;
        lock(session, realm);
        if (reserved(session, realm, normalized, user)) {
            context.addError(new ValidationError(ID, attribute, "emailExists").setStatusCode(Response.Status.CONFLICT));
        }
        return context;
    }

    static String normalize(String email) {
        return email == null ? "" : email.strip().toLowerCase(Locale.ROOT);
    }

    // Keep primary registration and secondary verification in the same realm-local transaction order.
    static void lock(KeycloakSession session, RealmModel realm) {
        session.getProvider(JpaConnectionProvider.class).getEntityManager()
            .find(RealmEntity.class, realm.getId(), LockModeType.PESSIMISTIC_WRITE);
    }

    static boolean reserved(KeycloakSession session, RealmModel realm, String normalized, UserModel user) {
        var users = UserStoragePrivateUtil.userLocalStorage(session);
        var owner = users.getUserByEmail(realm, normalized);
        if (owner != null && (user == null || !owner.getId().equals(user.getId()))) return true;
        var username = users.getUserByUsername(realm, normalized);
        if (username != null && (user == null || !username.getId().equals(user.getId()))) return true;
        try (var aliases = users.searchForUserByUserAttributeStream(realm, SECONDARY, normalized)) {
            return aliases.anyMatch(other -> user == null || !other.getId().equals(user.getId()));
        }
    }
}
