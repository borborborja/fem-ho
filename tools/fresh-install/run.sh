#!/usr/bin/env bash
# fresh-install — docs/13 M14.
#
# "`docker compose up` amb un `compose.yaml` net arrenca i porta a `/setup`; crear el
# primer administrador crea els tres àmbits."
#
# La prova aixeca **la pila real amb Compose** des d'un volum buit, i comprova el camí
# sencer del primer dia: la pàgina de setup, la creació de l'administrador, que la porta
# es tanqui, que el tauler respongui i que el CalDAV serveixi.
#
# Es fa amb Compose i no amb `docker run` a posta: el que ha de funcionar és el fitxer
# que la gent copiarà, no una comanda que només existeix aquí.
#
#   tools/fresh-install/run.sh [imatge]
#
# Sense argument construeix la imatge des del codi actual.
set -euo pipefail

cd "$(dirname "$0")/../.."

IMAGE="${1:-femho:fresh-install}"
PROJECT="femho-fresh"
COMPOSE_FILE="$(mktemp -t femho-compose-XXXXXX.yaml)"
PORT=18090
DAV_PORT=18091

DOCKER="docker"
if ! docker info >/dev/null 2>&1; then DOCKER="sudo docker"; fi

ok=0
fail=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    printf '  [ ok ] %-52s %s\n' "$name" "$actual"
    ok=$((ok + 1))
  else
    printf '  [FALLA] %-52s esperat %s, rebut %s\n' "$name" "$expected" "$actual"
    fail=$((fail + 1))
  fi
}

contains() {
  local name="$1" needle="$2" haystack="$3"
  if printf '%s' "$haystack" | grep -q -- "$needle"; then
    printf '  [ ok ] %-52s conté «%s»\n' "$name" "$needle"
    ok=$((ok + 1))
  else
    printf '  [FALLA] %-52s no conté «%s»\n' "$name" "$needle"
    printf '          %s\n' "$(printf '%s' "$haystack" | head -c 200)"
    fail=$((fail + 1))
  fi
}

cleanup() {
  $DOCKER compose -p "$PROJECT" -f "$COMPOSE_FILE" down -v >/dev/null 2>&1 || true
  rm -f "$COMPOSE_FILE"
}
trap cleanup EXIT

if [ "$IMAGE" = "femho:fresh-install" ]; then
  echo "fresh-install · construint la imatge…"
  $DOCKER build -t "$IMAGE" . >/dev/null
fi

# El `compose.yaml` real, amb tres canvis i cap més: la imatge local, els ports lliures
# i la URL pública que hi correspon. Si calgués tocar res més, voldria dir que el fitxer
# que publiquem no és el que provem.
sed \
  -e "s|image: ghcr.io/borborborja/fem-ho:1|image: $IMAGE|" \
  -e "s|'8080:8080'|'$PORT:8080'|" \
  -e "s|'8081:8081'|'$DAV_PORT:8081'|" \
  -e "s|https://femho.example.com|http://localhost:$PORT|" \
  compose.yaml > "$COMPOSE_FILE"

echo "fresh-install · aixecant la pila amb un volum buit…"
$DOCKER compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d >/dev/null

for _ in $(seq 1 60); do
  curl -sf "http://localhost:$PORT/healthz" >/dev/null 2>&1 && break
  sleep 1
done

echo
echo "el primer dia"
check "healthz respon" "200" "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/healthz")"
check "/setup és una pàgina" "text/html" \
  "$(curl -s -o /dev/null -w '%{content_type}' "http://localhost:$PORT/setup" | cut -d';' -f1)"
contains "i la porta és oberta" '"open":true' "$(curl -s "http://localhost:$PORT/api/v1/setup")"

SETUP=$(curl -s -X POST "http://localhost:$PORT/setup" \
  -H 'content-type: application/json' \
  -d '{"name":"Borja","email":"borja@example.com","password":"la-contrasenya-de-prova"}')

contains "crear l'administrador tanca la porta" '"setup_closed":true' "$SETUP"

# Tres àmbits inicials, ni un més ni un menys.
SCOPES=$(printf '%s' "$SETUP" | grep -o '"scope_ids":\[[^]]*\]' | grep -o ',' | wc -l)
check "i crea els tres àmbits" "2" "$SCOPES"

check "un segon intent és 403" "403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:$PORT/setup" \
    -H 'content-type: application/json' \
    -d '{"name":"Altre","email":"altre@example.com","password":"una-altra-contrasenya"}')"

echo
echo "amb sessió"
TOKEN=$(curl -s -X POST "http://localhost:$PORT/api/v1/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"borja@example.com","password":"la-contrasenya-de-prova"}' \
  | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "  [FALLA] el login no ha donat cap testimoni"
  fail=$((fail + 1))
else
  contains "el tauler torna les quatre columnes" '"status":"done"' \
    "$(curl -s "http://localhost:$PORT/api/v1/board" -H "authorization: Bearer $TOKEN")"

  SCOPE=$(curl -s "http://localhost:$PORT/api/v1/scopes" -H "authorization: Bearer $TOKEN" \
    | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  contains "es pot crear una tasca" '"title":"Comprar pa"' \
    "$(curl -s -X POST "http://localhost:$PORT/api/v1/tasks" \
      -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
      -d "{\"scope_id\":\"$SCOPE\",\"title\":\"Comprar pa\"}")"
fi

echo
echo "la web i el CalDAV"
contains "l'arrel serveix l'app" '<div id="root">' "$(curl -s "http://localhost:$PORT/")"
check "una ruta del client torna l'app" "200" \
  "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/dashboard")"
check "una ruta d'API inexistent NO torna l'app" "application/problem+json" \
  "$(curl -s -o /dev/null -w '%{content_type}' "http://localhost:$PORT/api/v1/no-existeix" | cut -d';' -f1)"
check "CalDAV respon a OPTIONS" "200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "http://localhost:$DAV_PORT/dav/")"

echo
echo "l'aturada"
$DOCKER compose -p "$PROJECT" -f "$COMPOSE_FILE" stop -t 10 >/dev/null 2>&1
CODE=$($DOCKER inspect -f '{{.State.ExitCode}}' "$($DOCKER compose -p "$PROJECT" -f "$COMPOSE_FILE" ps -aq | head -1)" 2>/dev/null || echo '?')
check "SIGTERM surt net" "0" "$CODE"

echo
echo "────────────────────────────────────────────────────────────"
printf 'fresh-install · %d correctes, %d fallades\n' "$ok" "$fail"
[ "$fail" -eq 0 ]
