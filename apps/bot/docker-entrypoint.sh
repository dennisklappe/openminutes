#!/bin/sh
set -eu

export XDG_RUNTIME_DIR=/tmp/runtime
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

rm -rf "$XDG_RUNTIME_DIR/pulse" "/tmp/.X${DISPLAY#:}-lock" "/tmp/.X11-unix/X${DISPLAY#:}"

Xvfb "$DISPLAY" -screen 0 1280x720x24 -nolisten tcp &
until [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ]; do sleep 0.1; done

pulseaudio -n --daemonize=yes --exit-idle-time=-1 --disallow-exit \
  -L "module-native-protocol-unix" \
  -L "module-null-sink sink_name=openminutes"
pactl set-default-sink openminutes

exec "$@"
