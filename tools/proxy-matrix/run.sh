#!/usr/bin/env bash
#
# `test: proxy-matrix` (docs/13 M14).
#
# Aixeca Fem-ho darrere de **nginx** i de **Caddy** amb LES CONFIGURACIONS DE `deploy/`
# —adaptades només a HTTP i als noms de servei— i comprova el que docs/12 §4 diu que
# falla a la gent:
#
#   1. Els verbs de CalDAV arriben al backend en comptes de rebre un 405 del proxy.
#   2. L'SSE surt sense memòria intermèdia.
#   3. `/.well-known/caldav` redirigeix, i conservant el port.
#
# Cal Docker. Amb sudo si el teu usuari no és al grup `docker`.
#
#   ./tools/proxy-matrix/run.sh

set -euo pipefail

DOCKER="${DOCKER:-docker}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
COMPOSE="$DOCKER compose -f $HERE/compose.yaml"
FAILURES=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    printf '  ok    %-34s %s\n' "$name" "$actual"
  else
    printf '  FALLA %-34s %s (esperat %s)\n' "$name" "$actual" "$expected"
    FAILURES=$((FAILURES + 1))
  fi
}

echo "proxy-matrix · construint la imatge"
$DOCKER build -q -t femho:proxytest "$ROOT" >/dev/null

# La configuració de nginx surt de deploy/, no se n'escriu una de paral·lela: provar una
# altra cosa que la que la gent es descarrega no diria res.
python3 - "$ROOT" "$HERE" <<'PY'
import sys
root, here = sys.argv[1], sys.argv[2]
s = open(f'{root}/deploy/nginx.conf').read()
s = s.replace('server 127.0.0.1:8080;', 'server femho:8080;')
s = s.replace('server 127.0.0.1:8081;', 'server femho:8081;')
s = s.replace('    listen 443 ssl http2;\n    server_name femho.example.com;\n', '    listen 80;\n    server_name _;\n')
s = s.replace('    ssl_certificate     /etc/letsencrypt/live/femho.example.com/fullchain.pem;\n', '')
s = s.replace('    ssl_certificate_key /etc/letsencrypt/live/femho.example.com/privkey.pem;\n', '')
s = s.replace('        return 301 https://$http_host/dav/;', '        return 301 http://$http_host/dav/;')
s = s.split('server {\n    listen 80;\n    server_name femho.example.com;')[0]
open(f'{here}/nginx.test.conf', 'w').write(
    '# GENERAT de deploy/nginx.conf. Només canvien el TLS i els amfitrions.\n' + s)
PY

trap '$COMPOSE down -v >/dev/null 2>&1 || true' EXIT
$COMPOSE up -d --force-recreate >/dev/null 2>&1

echo "proxy-matrix · esperant que el servidor estigui llest"
for _ in $(seq 1 30); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:18090/healthz || true)" = "200" ]; then break; fi
  sleep 2
done

curl -s -X POST http://localhost:18090/setup -H 'Content-Type: application/json' \
  -d '{"email":"proxy@example.com","name":"Proxy","password":"la-contrasenya-de-la-prova"}' >/dev/null || true
TOKEN=$(curl -s -X POST http://localhost:18090/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"proxy@example.com","password":"la-contrasenya-de-la-prova"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')

for entry in "nginx:18090" "caddy:18091"; do
  name="${entry%%:*}"; port="${entry##*:}"
  echo
  echo "── $name ──────────────────────────────────────────────"

  check "GET /healthz" 200 "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port/healthz")"
  check "OPTIONS /dav/" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "http://localhost:$port/dav/")"

  # AQUESTS són els que compten: un 405 voldria dir que el proxy els ha aturat. Un 401
  # vol dir que han arribat al backend, que és el que es prova aquí.
  for verb in PROPFIND PROPPATCH REPORT MKCALENDAR COPY MOVE; do
    check "$verb arriba al backend" 401 \
      "$(curl -s -o /dev/null -w '%{http_code}' -X "$verb" "http://localhost:$port/dav/" -H 'Depth: 0')"
  done

  check ".well-known/caldav" 301 \
    "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port/.well-known/caldav")"

  # El port s'ha de conservar: `$host` a nginx el perd, i en un desplegament que no
  # sigui al 443 la redirecció aniria a parar a un lloc que no existeix.
  redirect=$(curl -s -o /dev/null -w '%{redirect_url}' "http://localhost:$port/.well-known/caldav")
  case "$redirect" in
    *":$port/dav/") printf '  ok    %-34s %s\n' "el port es conserva" "$redirect" ;;
    *) printf '  FALLA %-34s %s\n' "el port es conserva" "$redirect"; FAILURES=$((FAILURES + 1)) ;;
  esac

  # L'SSE: el primer byte ha d'arribar de seguida. Amb memòria intermèdia, el proxy
  # esperaria a omplir un bloc i trigaria segons.
  read -r code elapsed <<<"$(curl -s -o /dev/null -w '%{http_code} %{time_starttransfer}' --max-time 8 \
    "http://localhost:$port/api/v1/stream" -H 'Accept: text/event-stream' \
    -H "Authorization: Bearer $TOKEN")"
  check "SSE respon" 200 "$code"

  if awk "BEGIN{exit !($elapsed < 1.0)}"; then
    printf '  ok    %-34s %ss\n' "SSE sense memòria intermèdia" "$elapsed"
  else
    printf '  FALLA %-34s %ss (massa)\n' "SSE sense memòria intermèdia" "$elapsed"
    FAILURES=$((FAILURES + 1))
  fi
done

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "proxy-matrix · tot correcte als dos proxies."
else
  echo "proxy-matrix · $FAILURES comprovacions han fallat."
  exit 1
fi
