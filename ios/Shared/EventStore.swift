import Foundation

// Event model matching Main Eventer's Firestore records (read-only).
// Fields: title, date (YYYY-MM-DD), startTime/endTime (HH:MM), price,
// ages, host, location, description, link. Empty fields are omitted,
// never invented.
struct SideshowEvent: Codable, Identifiable {
  var id: String = ""
  var title: String = ""
  var date: String = ""
  var startTime: String = ""
  var endTime: String = ""
  var price: String = ""
  var ages: String = ""
  var host: String = ""
  var location: String = ""
  var description: String = ""
  var link: String = ""

  private static let months = ["January", "February", "March", "April", "May", "June",
                               "July", "August", "September", "October", "November", "December"]
  private static let monthsS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  private static let days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  private static let daysS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

  static func parseDate(_ v: String) -> Date? {
    guard !v.isEmpty else { return nil }
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    f.locale = Locale(identifier: "en_US_POSIX")
    return f.date(from: v)
  }

  static func parseTimeMinutes(_ v: String) -> Int? {
    let p = v.split(separator: ":")
    guard p.count >= 2, let h = Int(p[0]), let m = Int(p[1]) else { return nil }
    return h * 60 + m
  }

  static func fmtTime(_ mins: Int) -> String {
    let h = mins / 60, m = mins % 60
    let ap = h >= 12 ? "PM" : "AM"
    var h12 = h % 12
    if h12 == 0 { h12 = 12 }
    return String(format: "%d:%02d %@", h12, m, ap)
  }

  static func fmtDateLong(_ d: Date) -> String {
    let cal = Calendar.current
    let wd = cal.component(.weekday, from: d) - 1
    let mo = cal.component(.month, from: d) - 1
    let day = cal.component(.day, from: d)
    let yr = cal.component(.year, from: d)
    return "\(days[wd]), \(months[mo]) \(day), \(yr)"
  }

  static func fmtDateShort(_ d: Date) -> String {
    let cal = Calendar.current
    let wd = cal.component(.weekday, from: d) - 1
    let mo = cal.component(.month, from: d) - 1
    let day = cal.component(.day, from: d)
    return "\(daysS[wd]), \(monthsS[mo]) \(day)"
  }

  var displayTitle: String { title.isEmpty ? "Untitled" : title }

  var subtitle: String {
    var parts: [String] = []
    if let d = Self.parseDate(date) { parts.append(Self.fmtDateShort(d)) }
    if let s = Self.parseTimeMinutes(startTime) { parts.append(Self.fmtTime(s)) }
    return parts.joined(separator: " · ")
  }

  // One chip per non-empty field, in order: name, date, start, end,
  // price, ages, host, location.
  func chips() -> [(label: String, value: String)] {
    var out: [(label: String, value: String)] = []
    if !title.isEmpty { out.append(("Name", title)) }
    if let d = Self.parseDate(date) { out.append(("Date", Self.fmtDateLong(d))) }
    if let s = Self.parseTimeMinutes(startTime) { out.append(("Start", Self.fmtTime(s))) }
    if let e = Self.parseTimeMinutes(endTime) { out.append(("End", Self.fmtTime(e))) }
    if !price.isEmpty { out.append(("Price", price)) }
    if !ages.isEmpty { out.append(("Ages", ages)) }
    if !host.isEmpty { out.append(("Host", host)) }
    if !location.isEmpty { out.append(("Location", location)) }
    return out
  }

  func matches(_ q: String) -> Bool {
    guard !q.isEmpty else { return true }
    let hay = [title, host, location, date, price, ages].joined(separator: " ").lowercased()
    return hay.contains(q.lowercased())
  }
}

// Shared storage for the App Group. The container app writes the events
// JSON here after sign-in; the keyboard extension reads it. The keyboard
// never talks to Firestore directly.
enum EventStore {
  static func containerURL() -> URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: SideshowConfig.appGroupID)
  }

  static func loadEvents() -> [SideshowEvent] {
    guard let url = containerURL()?.appendingPathComponent(SideshowConfig.eventsFileName),
          let data = try? Data(contentsOf: url),
          let events = try? JSONDecoder().decode([SideshowEvent].self, from: data) else {
      return []
    }
    return events
  }

  static func saveEvents(_ events: [SideshowEvent]) {
    guard let url = containerURL()?.appendingPathComponent(SideshowConfig.eventsFileName) else { return }
    guard let data = try? JSONEncoder().encode(events) else { return }
    try? data.write(to: url, options: .atomic)
  }
}
