#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$repo_root"

android_home="${ANDROID_HOME:-"$HOME/Library/Android/sdk"}"
export ANDROID_HOME="$android_home"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-"$ANDROID_HOME"}"

android_studio_jbr="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
if [[ -z "${JAVA_HOME:-}" && -d "$android_studio_jbr" ]]; then
  export JAVA_HOME="$android_studio_jbr"
fi

path_prefix=(
  "$ANDROID_HOME/emulator"
  "$ANDROID_HOME/platform-tools"
  "$ANDROID_HOME/cmdline-tools/latest/bin"
)

if [[ -n "${JAVA_HOME:-}" ]]; then
  path_prefix=("$JAVA_HOME/bin" "${path_prefix[@]}")
fi

export PATH="$(IFS=:; echo "${path_prefix[*]}"):$PATH"

require_command() {
  local command_name="$1"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
}

require_command adb
require_command emulator

android_avd="${ANDROID_AVD:-}"
if [[ -z "$android_avd" ]]; then
  avd_list="$(emulator -list-avds | sed '/^[[:space:]]*$/d')"

  if [[ -z "$avd_list" ]]; then
    echo "No Android virtual devices found. Create one in Android Studio Device Manager first." >&2
    exit 1
  fi

  android_avd="$(printf '%s\n' "$avd_list" | sed -n '1p')"
fi

log_file="${TMPDIR:-/tmp}/barefoot-blender-android-emulator.log"
booted_emulator="$(adb devices | awk '$2 == "device" && $1 ~ /^emulator-/ { print $1; exit }')"

if [[ -z "$booted_emulator" ]]; then
  echo "Starting Android emulator: $android_avd"
  nohup emulator -avd "$android_avd" -netdelay none -netspeed full >"$log_file" 2>&1 &
  echo "Emulator log: $log_file"
else
  echo "Using running Android emulator: $booted_emulator"
fi

adb wait-for-device

deadline=$((SECONDS + 240))
until [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; do
  if (( SECONDS > deadline )); then
    echo "Timed out waiting for Android emulator to boot." >&2
    echo "Check emulator log: $log_file" >&2
    exit 1
  fi

  sleep 2
done

adb shell input keyevent 82 >/dev/null 2>&1 || true

target_device="$(adb devices | awk '$2 == "device" && $1 ~ /^emulator-/ { print $1; exit }')"
if [[ -z "$target_device" ]]; then
  target_device="$(adb devices | awk '$2 == "device" { print $1; exit }')"
fi

if [[ -z "$target_device" ]]; then
  echo "No booted Android device found after emulator startup." >&2
  exit 1
fi

echo "Running Barefoot Blender debug build on Android target: $target_device"
npm run build:mobile:debug
npx cap run android --target "$target_device" --no-sync
