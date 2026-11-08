import UIKit

// Sideshow keyboard extension. Reads the saved events the container app
// synced into the App Group and inserts a tapped field into the active
// text field. The keyboard never talks to Firestore directly.
class KeyboardViewController: UIInputViewController {
  private var events: [SideshowEvent] = []
  private var scrollView: UIScrollView!
  private var stackView: UIStackView!
  private var searchField: UITextField!

  override func viewDidLoad() {
    super.viewDidLoad()
    setupViews()
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    reload()
  }

  private func setupViews() {
    view.backgroundColor = .systemBackground

    let toolbar = UIStackView()
    toolbar.axis = .horizontal
    toolbar.spacing = 8
    toolbar.alignment = .center

    let globe = UIButton(type: .system)
    globe.setTitle("🌐", for: .normal)
    globe.titleLabel?.font = .systemFont(ofSize: 20)
    globe.addTarget(self, action: #selector(handleInputModeList(from:with:)), for: .allTouchEvents)

    searchField = UITextField()
    searchField.placeholder = "Search"
    searchField.borderStyle = .roundedRect
    searchField.font = .systemFont(ofSize: 14)
    searchField.addTarget(self, action: #selector(searchChanged), for: .editingChanged)

    let dismiss = UIButton(type: .system)
    dismiss.setTitle("Done", for: .normal)
    dismiss.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
    dismiss.addTarget(self, action: #selector(doneTapped), for: .touchUpInside)

    toolbar.addArrangedSubview(globe)
    toolbar.addArrangedSubview(searchField)
    toolbar.addArrangedSubview(dismiss)

    scrollView = UIScrollView()
    scrollView.alwaysBounceVertical = true

    stackView = UIStackView()
    stackView.axis = .vertical
    stackView.spacing = 10
    stackView.alignment = .fill

    scrollView.addSubview(stackView)
    view.addSubview(toolbar)
    view.addSubview(scrollView)

    toolbar.translatesAutoresizingMaskIntoConstraints = false
    scrollView.translatesAutoresizingMaskIntoConstraints = false
    stackView.translatesAutoresizingMaskIntoConstraints = false

    NSLayoutConstraint.activate([
      toolbar.topAnchor.constraint(equalTo: view.topAnchor, constant: 6),
      toolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 10),
      toolbar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -10),

      scrollView.topAnchor.constraint(equalTo: toolbar.bottomAnchor, constant: 6),
      scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 10),
      scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -10),
      scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -6),

      stackView.topAnchor.constraint(equalTo: scrollView.topAnchor),
      stackView.leadingAnchor.constraint(equalTo: scrollView.leadingAnchor),
      stackView.trailingAnchor.constraint(equalTo: scrollView.trailingAnchor),
      stackView.bottomAnchor.constraint(equalTo: scrollView.bottomAnchor),
      stackView.widthAnchor.constraint(equalTo: scrollView.widthAnchor),
    ])
  }

  @objc private func searchChanged() {
    render()
  }

  @objc private func doneTapped() {
    dismissKeyboard()
  }

  private func reload() {
    events = EventStore.loadEvents()
    render()
  }

  private func render() {
    stackView.arrangedSubviews.forEach { $0.removeFromSuperview() }
    let q = searchField.text?.trimmingCharacters(in: .whitespaces) ?? ""
    let filtered = events.filter { $0.matches(q) }
    if filtered.isEmpty {
      let label = UILabel()
      label.text = events.isEmpty ? "Open Sideshow to sync." : "No matches."
      label.textColor = .secondaryLabel
      label.textAlignment = .center
      label.font = .systemFont(ofSize: 14)
      stackView.addArrangedSubview(label)
      return
    }
    for ev in filtered {
      let card = UIView()
      card.backgroundColor = .secondarySystemBackground
      card.layer.cornerRadius = 10

      let title = UILabel()
      title.text = ev.displayTitle
      title.font = .systemFont(ofSize: 14, weight: .bold)
      title.numberOfLines = 1

      let sub = UILabel()
      sub.text = ev.subtitle
      sub.font = .systemFont(ofSize: 12)
      sub.textColor = .secondaryLabel
      sub.numberOfLines = 1

      let chipRows = UIStackView()
      row.axis = .horizontal
      row.spacing = 6
      let chipRows = UIStackView()
      chipRows.axis = .vertical
      chipRows.spacing = 6
      // Wrap chips onto multiple rows.
      var row = UIStackView()
      row.axis = .horizontal
      row.spacing = 6
      for chip in ev.chips() {
        let b = UIButton(type: .system)
        let label = chip.label.uppercased() + "  " + chip.value
        b.setTitle(label, for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 13)
        b.titleLabel?.lineBreakMode = .byTruncatingTail
        b.backgroundColor = .tertiarySystemBackground
        b.layer.cornerRadius = 14
        b.contentEdgeInsets = UIEdgeInsets(top: 5, left: 10, bottom: 5, right: 10)
        b.addTarget(self, action: #selector(chipTapped(_:)), for: .touchUpInside)
        b.accessibilityIdentifier = chip.value
        // Keep the row from overflowing: start a new row when it gets full.
        row.addArrangedSubview(b)
        if row.arrangedSubviews.count >= 2 {
          chipRows.addArrangedSubview(row)
          row = UIStackView()
          row.axis = .horizontal
          row.spacing = 6
        }
      }
      if !row.arrangedSubviews.isEmpty { chipRows.addArrangedSubview(row) }

      let cardStack = UIStackView(arrangedSubviews: [title, sub, chipRows])
      cardStack.axis = .vertical
      cardStack.spacing = 4
      card.addSubview(cardStack)
      cardStack.translatesAutoresizingMaskIntoConstraints = false
      NSLayoutConstraint.activate([
        cardStack.topAnchor.constraint(equalTo: card.topAnchor, constant: 8),
        cardStack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 10),
        cardStack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -10),
        cardStack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -8),
      ])
      stackView.addArrangedSubview(card)
    }
  }

  @objc private func chipTapped(_ sender: UIButton) {
    guard let value = sender.accessibilityIdentifier, !value.isEmpty else { return }
    textDocumentProxy.insertText(value)
  }
}
