#!/usr/bin/env bash
# Starts Fretwise's MariaDB in Warden and points the dev server at it. Safe to run again: it keeps existing
# passwords and data. Afterwards restart `npm run dev`.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v warden >/dev/null || export PATH="/home/linuxbrew/.linuxbrew/bin:$PATH"
command -v warden >/dev/null || { echo "Warden isn't installed (https://docs.warden.dev)." >&2; exit 1; }

pw() { head -c 18 /dev/urandom | base64 | tr -d '/+=' ; }
get() { grep -E "^$1=" .env | head -1 | cut -d= -f2- ; }

# Sets NAME=value in a file (adds the line when it's missing). Bash builtins only, so the value never shows
# on a command line where `ps` could see it.
set_var() {
  local file=$1 name=$2 value=$3 line out='' found=''
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ $line == "$name="* ]]; then
      out+="$name=$value"$'\n'
      found=1
    else
      out+="$line"$'\n'
    fi
  done < "$file"
  [ -n "$found" ] || out+="$name=$value"$'\n'
  (umask 077 && printf '%s' "$out" > "$file.tmp")
  mv "$file.tmp" "$file"
}

if [ ! -f .env ]; then
  cp .warden/env.example .env
  chmod 600 .env
fi
[ -n "$(get MYSQL_PASSWORD)" ] || set_var .env MYSQL_PASSWORD "$(pw)"
[ -n "$(get MYSQL_ROOT_PASSWORD)" ] || set_var .env MYSQL_ROOT_PASSWORD "$(pw)"

warden env up

base="mysql://$(get MYSQL_USER):$(get MYSQL_PASSWORD)@127.0.0.1:$(get FRETWISE_DB_PORT)"
touch .env.local
chmod 600 .env.local
set_var .env.local FRETWISE_DB_URL "$base/$(get MYSQL_DATABASE)"
# The tests read it from here (see the README), so the password is never typed.
set_var .env.local FRETWISE_TEST_DB_URL "$base/fretwise_test"

# Passwords are read inside the container from its own environment (set from .env), so they never show on
# this computer's command lines.
in_db() { warden env exec -T db sh -c "$1"; }

printf 'Waiting for MariaDB'
ready=
for _ in $(seq 1 60); do
  if in_db 'MYSQL_PWD="$MYSQL_PASSWORD" mariadb-admin ping -u"$MYSQL_USER" --silent' >/dev/null 2>&1; then
    ready=1
    break
  fi
  printf '.'
  sleep 2
done
if [ -z "$ready" ]; then
  echo ' not ready after 2 minutes: check `warden env logs db`.' >&2
  exit 1
fi
echo ' ready.'

# The tests' own database (FRETWISE_TEST_DB_URL): emptied by every test run, so never point it at real data.
in_db 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mariadb -uroot -e "CREATE DATABASE IF NOT EXISTS fretwise_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL PRIVILEGES ON fretwise_test.* TO \`$MYSQL_USER\`@\`%\`;"'
echo 'Test database fretwise_test is ready.'
echo 'FRETWISE_DB_URL and FRETWISE_TEST_DB_URL are in .env.local. Restart the dev server (npm run dev) to use the database.'
