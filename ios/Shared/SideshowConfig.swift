import Foundation

// Sideshow shared config. No secrets here. The Firebase config lives in
// GoogleService-Info.plist, which the user adds from the Firebase console
// (it is not in this repo).
enum SideshowConfig {
  static let appGroupID = "group.com.firedarts.sideshow"
  static let eventsFileName = "sideshow-events.json"
  static let firestoreCollection = "mainEvent_events"
  static let allowlist = ["kylematthewberry@gmail.com", "rochelleberry731@gmail.com"]
}
