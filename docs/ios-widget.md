# iOS home-screen widget ("next deadline")

A small WidgetKit widget showing the soonest upcoming deadline. The web app
already computes it and pushes it on every dashboard load (`lib/widget.ts` →
`WidgetBridge` plugin); the native side below has to be wired in **your Xcode**
(it can't be built/verified outside Xcode).

## Pieces in this repo (scaffold)
- `apps/web/src/lib/widget.ts` — pushes `{label,date,vehicle,daysRemaining}` to
  the widget (native-only, no-op on web). Already wired into the dashboard.
- `ios/App/App/WidgetBridgePlugin.swift` — Capacitor plugin: writes the JSON to
  the shared App Group and reloads the widget timeline.
- `ios/App/GarajimWidget/GarajimWidget.swift` — the widget (timeline + view).

## Xcode wiring (one-time)
1. **App Group.** In Apple Developer + Xcode, create/enable App Group
   `group.com.mehditerzi.mototracker`. Add the **App Groups** capability to the
   **App** target with that group.
2. **Add the plugin** to the App target: drag `WidgetBridgePlugin.swift` into the
   `App` target (it auto-registers via `CAPBridgedPlugin`).
3. **Add the widget target.** File → New → Target → **Widget Extension**, name it
   `GarajimWidget` (uncheck "Include Configuration Intent"). Replace the generated
   Swift with `GarajimWidget.swift` from this repo.
4. Add the **App Groups** capability to the **GarajimWidget** target too, same
   group id (both targets must share it).
5. `cap:build` / build & run. Long-press the home screen → add the Garajım widget.

## How data flows
Dashboard loads → `pushNextDeadline(...)` → `WidgetBridge.setNextDeadline` writes
JSON to `UserDefaults(suiteName: group…)` and calls
`WidgetCenter.reloadAllTimelines()` → the widget's `Provider.loadEntry()` reads it.
When there's no upcoming deadline the app pushes `null` and the widget shows an
empty state.

## Notes
- `cap sync` does NOT manage the widget target — it's a manual Xcode target, so it
  persists across syncs but you add it once by hand.
- The group id is hard-coded in three places (plugin, widget, this doc) — keep
  them identical if you change it.
- Families: only `.systemSmall` is scaffolded; add medium/large in the widget's
  `supportedFamilies` if you want.
