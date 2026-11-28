export const OPERATOR_DISPLAY_NAME_ATTRIBUTE = 'platfolioDisplayName';

const permissions = { view: ['admin', 'user'], edit: ['admin', 'user'] };
const required = { roles: ['user'] };
const nameValidators = { length: { max: 255 }, 'person-name-prohibited-characters': {} };

export const operatorDisplayName = {
  name: OPERATOR_DISPLAY_NAME_ATTRIBUTE, displayName: 'Display name',
  validations: { length: { max: 100 } }, permissions, multivalued: false,
};

// Keycloak applies the component per realm. Keep the built-in account field validators
// when adding the one Platfolio attribute to the imported profile.
const profile = {
  attributes: [
    { name: 'username', displayName: '${username}', permissions,
      validations: { length: { min: 3, max: 255 }, 'username-prohibited-characters': {}, 'up-username-not-idn-homograph': {} } },
    { name: 'email', displayName: '${email}', permissions, required, validations: { email: {}, length: { max: 255 } } },
    { name: 'firstName', displayName: '${firstName}', permissions, required, validations: nameValidators },
    { name: 'lastName', displayName: '${lastName}', permissions, required, validations: nameValidators },
    operatorDisplayName,
  ],
  groups: [{ name: 'user-metadata', displayHeader: 'User metadata', displayDescription: 'Attributes, which refer to user metadata' }],
};

export const operatorProfileComponents = {
  'org.keycloak.userprofile.UserProfileProvider': [{
    name: 'declarative-user-profile', providerId: 'declarative-user-profile',
    config: { 'kc.user.profile.config': [JSON.stringify(profile)] },
  }],
};
