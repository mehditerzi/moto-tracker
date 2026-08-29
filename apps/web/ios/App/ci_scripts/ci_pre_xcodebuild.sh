#!/bin/sh
# Xcode Cloud: stamp the build number from CI_BUILD_NUMBER.
#
# App Store Connect rejects an upload whose CFBundleVersion it has already seen
# for that CFBundleShortVersionString. The project has CURRENT_PROJECT_VERSION
# hard-coded to 1, so the FIRST automated upload would succeed and every one
# after it would fail with "The bundle version must be higher than the
# previously uploaded version" — which reads like a signing problem and is not.
#
# CI_BUILD_NUMBER is monotonic per Xcode Cloud workflow, so it is exactly the
# right source. MARKETING_VERSION stays under human control: bump it in the
# project when you intend a new user-visible version.
set -eu

: "${CI_BUILD_NUMBER:?not running under Xcode Cloud}"
plist="$CI_PRIMARY_REPOSITORY_PATH/apps/web/ios/App/App/Info.plist"

echo "--- ci_pre_xcodebuild: CFBundleVersion -> $CI_BUILD_NUMBER"

# Info.plist uses $(CURRENT_PROJECT_VERSION), so setting the plist alone would
# be overwritten by the build setting. agvtool writes the setting itself.
cd "$CI_PRIMARY_REPOSITORY_PATH/apps/web/ios/App"
agvtool new-version -all "$CI_BUILD_NUMBER"

echo "--- marketing version: $(agvtool what-marketing-version -terse1 2>/dev/null || echo '?')"
echo "--- ci_pre_xcodebuild: ok"
