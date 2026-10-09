#!/usr/bin/env bash
set -e

ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
APK="app/build/outputs/apk/debug/app-debug.apk"
PACKAGE="com.noteworthy.android"

echo "Waiting for device to connect via ADB..."
"$ADB" wait-for-device

echo "Device detected. Installing $APK..."
"$ADB" install -r "$APK"

echo "Launching $PACKAGE..."
"$ADB" shell am start -n "$PACKAGE/$PACKAGE.MainActivity"

echo "Done! Noteworthy is now running on your phone."
