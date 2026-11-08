import SwiftUI
import FirebaseAuth
import FirebaseFirestore
import GoogleSignIn

// Container app: sign in with Google, sync the saved Main Eventer events
// into the shared App Group so the keyboard can read them. Read-only.
struct ContentView: View {
  @State private var email: String? = nil
  @State private var status: String = ""
  @State private var events: [SideshowEvent] = []
  @State private var configured: Bool = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil

  var body: some View {
    NavigationView {
      VStack(alignment: .leading, spacing: 14) {
        if !configured {
          Text("Add GoogleService-Info.plist")
            .font(.headline)
          Text("Copy it from the Firebase console into this project.")
            .foregroundColor(.secondary)
        } else if email == nil {
          Button("Sign in with Google", action: signIn)
            .buttonStyle(.borderedProminent)
        } else {
          Text(email ?? "")
            .foregroundColor(.secondary)
          HStack {
            Button("Sync", action: sync)
              .buttonStyle(.borderedProminent)
            Button("Sign out", action: signOut)
              .buttonStyle(.bordered)
          }
        }
        if !status.isEmpty {
          Text(status).foregroundColor(.secondary)
        }
        List(events) { ev in
          VStack(alignment: .leading, spacing: 4) {
            Text(ev.displayTitle).font(.headline)
            if !ev.subtitle.isEmpty {
              Text(ev.subtitle).font(.subheadline).foregroundColor(.secondary)
            }
          }
        }
        .listStyle(.plain)
      }
      .padding()
      .navigationTitle("Sideshow")
    }
    .onAppear {
      if let user = Auth.auth().currentUser {
        email = user.email
        events = EventStore.loadEvents()
      }
    }
  }

  private func rootViewController() -> UIViewController? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }?.rootViewController
  }

  private func signIn() {
    guard let vc = rootViewController() else { return }
    GIDSignIn.sharedInstance.signIn(withPresenting: vc) { result, error in
      guard error == nil,
            let user = result?.user,
            let idToken = user.idToken?.tokenString else {
        status = "Sign-in failed."
        return
      }
      let credential = GoogleAuthProvider.credential(
        withIDToken: idToken,
        accessToken: user.accessToken.tokenString)
      Auth.auth().signIn(with: credential) { authResult, error in
        guard error == nil, let user = authResult?.user else {
          status = "Sign-in failed."
          return
        }
        let em = (user.email ?? "").lowercased()
        if !SideshowConfig.allowlist.contains(em) {
          try? Auth.auth().signOut()
          status = "That Google account is not on the studio list."
          return
        }
        email = user.email
        status = ""
        sync()
      }
    }
  }

  private func signOut() {
    try? Auth.auth().signOut()
    email = nil
    events = []
  }

  private func sync() {
    let db = Firestore.firestore()
    db.collection(SideshowConfig.firestoreCollection)
      .order(by: "updatedAt", descending: true)
      .limit(to: 50)
      .getDocuments { snap, error in
        guard error == nil, let snap = snap else {
          status = "Could not load events."
          return
        }
        var out: [SideshowEvent] = []
        for doc in snap.documents {
          let d = doc.data()
          var ev = SideshowEvent()
          ev.id = doc.documentID
          ev.title = d["title"] as? String ?? ""
          ev.date = d["date"] as? String ?? ""
          ev.startTime = d["startTime"] as? String ?? ""
          ev.endTime = d["endTime"] as? String ?? ""
          ev.price = d["price"] as? String ?? ""
          ev.ages = d["ages"] as? String ?? ""
          ev.host = d["host"] as? String ?? ""
          ev.location = d["location"] as? String ?? ""
          ev.description = d["description"] as? String ?? ""
          ev.link = d["link"] as? String ?? ""
          out.append(ev)
        }
        EventStore.saveEvents(out)
        events = out
        status = ""
      }
  }
}
