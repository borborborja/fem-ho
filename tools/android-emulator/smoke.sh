#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
serial="${ANDROID_SERIAL:?Set ANDROID_SERIAL to the isolated emulator}"
[[ "$serial" == emulator-* ]]
[[ "$(adb -s "$serial" shell getprop ro.kernel.qemu | tr -d '\r')" == 1 ]]

port="${FEMHO_ANDROID_TEST_PORT:-4186}"
dav_port="$((port + 1))"
work_dir="$(mktemp -d)"
echo "Android smoke output: $work_dir"

if [[ "${FEMHO_ANDROID_USE_BUILT_SERVER:-0}" != 1 ]]; then
  npm run build -w @fem-ho/contracts
  npm run build -w @fem-ho/server
fi
FEMHO_PORT="$port" FEMHO_DAV_PORT="$dav_port" \
  FEMHO_DATA_DIR="$work_dir/data" FEMHO_DATABASE_URL="sqlite://$work_dir/data/test.sqlite" \
  FEMHO_BASE_URL="http://10.0.2.2:$port" FEMHO_ALLOW_REGISTRATION=true \
  node apps/server/dist/index.js > "$work_dir/server.log" 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT
for ((checks = 0; checks < 30; checks++)); do
  if curl --silent --fail "http://127.0.0.1:$port/healthz" > /dev/null; then break; fi
  sleep 1
done
curl --silent --fail "http://127.0.0.1:$port/healthz" > /dev/null
node tools/android-emulator/fixture.mjs "http://127.0.0.1:$port" smoke > "$work_dir/fixture.json"

if [[ "${FEMHO_ANDROID_USE_BUILT_APKS:-0}" != 1 ]]; then
  (cd apps/android && ./gradlew :app:assembleDebug :app:assembleDebugAndroidTest --console=plain)
fi
apk_dir=apps/android/app/build/outputs/apk
adb -s "$serial" install -r "$apk_dir/debug/app-debug.apk"
adb -s "$serial" install -r "$apk_dir/androidTest/debug/app-debug-androidTest.apk"
adb -s "$serial" shell input keyevent 82

mapfile -t fixture < <(node --input-type=module - "$work_dir/fixture.json" <<'JS'
import { readFileSync } from 'node:fs';
const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const [key, value] of Object.entries(fixture)) {
  process.stdout.write(`-e\n${key}\n${value}\n`);
}
JS
)
selection=()
if [[ -n "${FEMHO_ANDROID_TEST_CLASS:-}" ]]; then
  selection=(-e class "$FEMHO_ANDROID_TEST_CLASS")
fi
adb -s "$serial" shell am instrument -w -r \
  -e serverUrl "http://10.0.2.2:$port" "${fixture[@]}" "${selection[@]}" \
  ho.fem.test/androidx.test.runner.AndroidJUnitRunner | tee "$work_dir/instrumentation.log"
grep -E '^OK \([1-9][0-9]* tests?\)' "$work_dir/instrumentation.log"
