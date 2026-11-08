import SwiftUI
import FirebaseCore

@main
struct SideshowApp: App {
  init() {
    // Firebase needs GoogleService-Info.plist (added by the user, not in
    // this repo). If it is missing, the app still launches and ContentView
    // shows the config state instead of crashing.
    if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
      FirebaseApp.configure()
    }
  }

  var body: some Scene {
    WindowGroup {
      ContentView()
    }
  }
}
