package dev.platfolio.identity;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.regex.Pattern;

import jakarta.persistence.LockModeType;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import org.keycloak.Config;
import org.keycloak.authentication.actiontoken.DefaultActionToken;
import org.keycloak.authentication.actiontoken.execactions.ExecuteActionsActionToken;
import org.keycloak.authentication.actiontoken.verifyemail.VerifyEmailActionToken;
import org.keycloak.common.util.Time;
import org.keycloak.connections.jpa.JpaConnectionProvider;
import org.keycloak.email.EmailException;
import org.keycloak.email.EmailSenderProvider;
import org.keycloak.email.EmailTemplateProvider;
import org.keycloak.models.Constants;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.models.jpa.entities.UserEntity;
import org.keycloak.services.managers.AppAuthManager;
import org.keycloak.services.resource.RealmResourceProvider;
import org.keycloak.services.resource.RealmResourceProviderFactory;
import org.keycloak.services.resources.LoginActionsService;

public final class OperatorEmailResource implements RealmResourceProviderFactory {
    static final String WEB_CLIENT = "platfolio-web";
    static final String PUBLIC_POLICY = "platfolio.publicAccounts";
    private static final int LINK_SECONDS = 900;
    private static final int RESEND_SECONDS = 60;
    private static final int MAX_SECONDARIES = 8;
    private static final String PENDING = "platfolio.pendingEmail";
    private static final String PENDING_HASH = "platfolio.pendingEmailHash";
    private static final String PENDING_SENT = "platfolio.pendingEmailSent";
    private static final Pattern ADDRESS = Pattern.compile("[^<>\\s@]+@[^<>\\s@]+\\.[^<>\\s@]+");
    private static final Pattern CODE = Pattern.compile("[A-Za-z0-9_-]{24}");
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Base64.Encoder BASE64 = Base64.getUrlEncoder().withoutPadding();

    @Override public String getId() { return "platfolio-account-email"; }
    @Override public void init(Config.Scope config) {}
    @Override public void postInit(KeycloakSessionFactory factory) {}
    @Override public void close() {}

    @Override
    public RealmResourceProvider create(KeycloakSession session) {
        return new RealmResourceProvider() {
            @Override public Object getResource() { return new Resource(session); }
            @Override public void close() {}
        };
    }

    public record EmailRequest(String action) {}
    public record AddressRequest(String action, String email, String code) {}
    public record Address(String email, boolean primary, boolean verified) {}
    public record Emails(boolean selfVerification, boolean multipleEmails, List<Address> addresses) {}

    public static class Resource {
        private final KeycloakSession session;
        private final RealmModel realm;

        public Resource(KeycloakSession session) {
            this.session = session;
            this.realm = session.getContext().getRealm();
        }

        @GET
        @Path("addresses")
        @Produces(MediaType.APPLICATION_JSON)
        public Response addresses() {
            var user = operator();
            return user == null ? status(401) : addresses(user);
        }

        private Response addresses(UserModel user) {
            boolean enabled = realm.getAttribute(PUBLIC_POLICY, false);
            var addresses = new ArrayList<Address>();
            if (user.getEmail() != null) addresses.add(new Address(user.getEmail(), true, user.isEmailVerified()));
            if (enabled) {
                user.getAttributeStream(OperatorEmailUniqueness.SECONDARY).sorted()
                    .forEach(address -> addresses.add(new Address(address, false, true)));
                var pending = user.getFirstAttribute(PENDING);
                if (pending != null) addresses.add(new Address(pending, false, false));
            }
            return Response.ok(new Emails(enabled, enabled, addresses)).header("Cache-Control", "no-store").build();
        }

        @POST
        @Path("addresses")
        @Consumes(MediaType.APPLICATION_JSON)
        @Produces(MediaType.APPLICATION_JSON)
        public Response updateAddresses(AddressRequest request) {
            var user = operator();
            if (user == null) return status(401);
            if (!realm.getAttribute(PUBLIC_POLICY, false)) return status(403);
            if (request == null || request.action() == null) return status(400);
            var email = OperatorEmailUniqueness.normalize(request.email());
            if (email.length() > 254 || !ADDRESS.matcher(email).matches()) return status(400);
            var action = request.action();
            // Primary writes and ownership claims serialize with Keycloak user-profile validation.
            if (!"add".equals(action)) OperatorEmailUniqueness.lock(session, realm);
            lockUser(user);
            String primary = OperatorEmailUniqueness.normalize(user.getEmail());
            var secondary = new LinkedHashSet<>(user.getAttributeStream(OperatorEmailUniqueness.SECONDARY).toList());
            if (primary.equals(email)) return status(409);
            var pending = user.getFirstAttribute(PENDING);
            switch (action) {
                case "add":
                    if (secondary.size() >= MAX_SECONDARIES || secondary.contains(email)) return status(409);
                    if (sentAt(user, PENDING_SENT) > Time.currentTime() - RESEND_SECONDS) return status(429);
                    if (!sendSecondary(user, email)) return status(503);
                    break;
                case "verify":
                    if (secondary.size() >= MAX_SECONDARIES) return status(409);
                    var code = request.code();
                    var hash = user.getFirstAttribute(PENDING_HASH);
                    if (code == null || !CODE.matcher(code).matches() || hash == null || !email.equals(pending)
                            || sentAt(user, PENDING_SENT) <= Time.currentTime() - LINK_SECONDS
                            || !MessageDigest.isEqual(hash.getBytes(StandardCharsets.US_ASCII), digest(code).getBytes(StandardCharsets.US_ASCII))) {
                        return status(400);
                    }
                    if (OperatorEmailUniqueness.reserved(session, realm, email, user)) return status(409);
                    secondary.add(email);
                    clearPending(user);
                    break;
                case "make-primary":
                    if (!secondary.remove(email) || OperatorEmailUniqueness.reserved(session, realm, email, user)) return status(409);
                    if (user.isEmailVerified() && !primary.isEmpty()) secondary.add(primary);
                    user.setEmail(email);
                    user.setEmailVerified(true);
                    break;
                case "remove":
                    if (email.equals(pending)) clearPending(user);
                    else if (!secondary.remove(email)) return status(409);
                    break;
                default:
                    return status(400);
            }
            if (!"add".equals(action)) user.setAttribute(OperatorEmailUniqueness.SECONDARY, List.copyOf(secondary));
            return addresses(user);
        }

        private void lockUser(UserModel user) {
            session.getProvider(JpaConnectionProvider.class).getEntityManager()
                .find(UserEntity.class, user.getId(), LockModeType.PESSIMISTIC_WRITE);
        }

        private boolean sendSecondary(UserModel user, String email) {
            var config = realm.getSmtpConfig();
            if (config.getOrDefault("host", "").isBlank()) return false;
            var entropy = new byte[18];
            RANDOM.nextBytes(entropy);
            var code = BASE64.encodeToString(entropy);
            var message = "Your Platfolio verification code is " + code + ". Enter it in Account → Emails within 15 minutes.";
            try {
                session.getProvider(EmailSenderProvider.class).send(config, email, "Verify your Platfolio email", message, null);
            } catch (EmailException exception) {
                return false;
            }
            user.setSingleAttribute(PENDING, email);
            user.setSingleAttribute(PENDING_HASH, digest(code));
            user.setSingleAttribute(PENDING_SENT, Integer.toString(Time.currentTime()));
            return true;
        }

        private static String digest(String code) {
            try {
                return BASE64.encodeToString(MessageDigest.getInstance("SHA-256").digest(code.getBytes(StandardCharsets.US_ASCII)));
            } catch (NoSuchAlgorithmException exception) {
                throw new IllegalStateException("SHA-256 is unavailable", exception);
            }
        }

        private static void clearPending(UserModel user) {
            user.removeAttribute(PENDING);
            user.removeAttribute(PENDING_HASH);
        }

        private static long sentAt(UserModel user, String attribute) {
            var value = user.getFirstAttribute(attribute);
            return value == null ? 0 : Long.parseLong(value);
        }

        @POST
        @Consumes(MediaType.APPLICATION_JSON)
        @Produces(MediaType.APPLICATION_JSON)
        public Response send(EmailRequest request) {
            UserModel user = operator();
            if (user == null) return status(401);
            if (request == null || request.action() == null) return status(400);
            boolean verification = "verify-primary".equals(request.action());
            if (!verification && !"reset-password".equals(request.action())) return status(400);
            if (verification ? !realm.getAttribute(PUBLIC_POLICY, false) : !realm.isResetPasswordAllowed()) return status(403);
            if (user.getEmail() == null || verification == user.isEmailVerified()) return status(409);
            if (realm.getSmtpConfig().getOrDefault("host", "").isBlank()) return status(503);

            lockUser(user);
            String lastSent = verification ? "platfolio.primaryVerifySent" : "platfolio.passwordResetSent";
            int now = Time.currentTime();
            if (sentAt(user, lastSent) > now - RESEND_SECONDS) {
                return status(429);
            }
            var template = session.getProvider(EmailTemplateProvider.class).setRealm(realm).setUser(user);
            try {
                if (verification) {
                    var token = new VerifyEmailActionToken(user.getId(), now + LINK_SECONDS, null, user.getEmail(), WEB_CLIENT);
                    template.sendVerifyEmail(link(token), LINK_SECONDS / 60);
                } else {
                    var actions = List.of(UserModel.RequiredAction.UPDATE_PASSWORD.name());
                    var token = new ExecuteActionsActionToken(user.getId(), user.getEmail(), now + LINK_SECONDS, actions, null, WEB_CLIENT);
                    template.setAttribute(Constants.TEMPLATE_ATTR_REQUIRED_ACTIONS, actions)
                        .sendExecuteActions(link(token), LINK_SECONDS / 60);
                }
                user.setSingleAttribute(lastSent, Integer.toString(now));
                return status(204);
            } catch (EmailException exception) {
                return status(503);
            }
        }

        private UserModel operator() {
            if (!"platfolio".equals(realm.getName())) return null;
            var auth = new AppAuthManager.BearerTokenAuthenticator(session).setAudience("account").authenticate();
            if (auth == null || !WEB_CLIENT.equals(auth.token().getIssuedFor())) return null;
            var account = auth.token().getResourceAccess("account");
            var user = auth.user();
            return account != null && account.isUserInRole("manage-account") && user.isEnabled()
                && user.getServiceAccountClientLink() == null && user.getFederationLink() == null ? user : null;
        }

        private String link(DefaultActionToken token) {
            var uri = session.getContext().getUri();
            return LoginActionsService.actionTokenProcessor(uri)
                .queryParam("key", token.serialize(session, realm, uri)).build(realm.getName()).toString();
        }

        private static Response status(int status) {
            var response = Response.status(status).header("Cache-Control", "no-store");
            if (status != 204) response.type(MediaType.APPLICATION_JSON_TYPE);
            return response.build();
        }
    }
}
