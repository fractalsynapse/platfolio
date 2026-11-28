#!/bin/sh
set -eu

if [ "${1:-}" = start-private ]; then
  shift
  : "${PLATFOLIO_SITE_ORIGIN:?Set the private site origin}"
  : "${PLATFOLIO_INSTALL_OWNER_EMAIL:?Set the initial owner email}"

  case "$PLATFOLIO_SITE_ORIGIN" in
    https://*) hostname=${PLATFOLIO_SITE_ORIGIN#https://} ;;
    http://127.0.0.1:*) hostname=${PLATFOLIO_SITE_ORIGIN#http://} ;;
    *) echo 'Use an HTTPS site origin or local loopback' >&2; exit 1 ;;
  esac
  case "$hostname" in
    ''|*[!a-zA-Z0-9.:-]*) echo 'Use an exact site origin without a path or wildcard' >&2; exit 1 ;;
  esac
  case "$PLATFOLIO_INSTALL_OWNER_EMAIL" in
    *[[:space:]]*|*@*@*) echo 'Use an email address for the initial owner' >&2; exit 1 ;;
    ?*@?*.?*) ;;
    *) echo 'Use an email address for the initial owner' >&2; exit 1 ;;
  esac
  variant=
  if [ -n "${PLATFOLIO_INSTALL_OWNER_VERIFIER:-}${PLATFOLIO_INSTALL_OWNER_SALT:-}" ]; then
    : "${PLATFOLIO_INSTALL_OWNER_VERIFIER:?Set the initial owner verifier}"
    : "${PLATFOLIO_INSTALL_OWNER_SALT:?Set the initial owner salt}"
    variant=-with-verifier
  else
    : "${PLATFOLIO_INSTALL_OWNER_PASSWORD:?Set the generated initial owner password}"
    case "$PLATFOLIO_INSTALL_OWNER_PASSWORD" in
      *[!a-zA-Z0-9_-]*) echo 'Use a generated URL-safe initial owner password' >&2; exit 1 ;;
    esac
    if [ "${#PLATFOLIO_INSTALL_OWNER_PASSWORD}" -lt 32 ]; then
      echo 'Use a generated initial owner password of at least 32 characters' >&2
      exit 1
    fi
  fi

  if [ -z "${KC_BOOTSTRAP_ADMIN_PASSWORD:-}" ]; then
    unset KC_BOOTSTRAP_ADMIN_USERNAME KC_BOOTSTRAP_ADMIN_PASSWORD
  fi

  if [ -z "${PLATFOLIO_INSTALL_OWNER_SUBJECT:-}" ]; then
    read -r PLATFOLIO_INSTALL_OWNER_SUBJECT < /proc/sys/kernel/random/uuid
    export PLATFOLIO_INSTALL_OWNER_SUBJECT
  fi
  realm=platfolio-realm$variant
  if [ -n "${PLATFOLIO_SMTP_HOST:-}${PLATFOLIO_SMTP_PORT:-}${PLATFOLIO_EMAIL_FROM:-}${PLATFOLIO_SMTP_USER:-}${PLATFOLIO_SMTP_PASSWORD:-}" ]; then
    : "${PLATFOLIO_SMTP_HOST:?Set the private mail relay host}"
    : "${PLATFOLIO_SMTP_PORT:?Set the private mail relay port}"
    : "${PLATFOLIO_EMAIL_FROM:?Set the private mail sender address}"
    : "${PLATFOLIO_SMTP_USER:?Set the private mail relay username}"
    : "${PLATFOLIO_SMTP_PASSWORD:?Set the private mail relay password}"
    realm=$realm-with-mail
  fi
  if [ -n "${PLATFOLIO_PRIVATE_SETUP_KEY:-}" ]; then
    case "$PLATFOLIO_PRIVATE_SETUP_KEY" in
      *[!a-zA-Z0-9_-]*) echo 'Use a generated URL-safe private setup grant' >&2; exit 1 ;;
    esac
    if [ "${#PLATFOLIO_PRIVATE_SETUP_KEY}" -lt 32 ]; then
      echo 'Use a generated private setup grant of at least 32 characters' >&2
      exit 1
    fi
    realm=$realm-with-setup
  fi
  mkdir -p /opt/keycloak/data/import
  cp "/opt/keycloak/platfolio-private/$realm.json" /opt/keycloak/data/import/platfolio-realm.json
  exec /opt/keycloak/bin/kc.sh start --import-realm "$@"
fi

exec /opt/keycloak/bin/kc.sh "$@"
