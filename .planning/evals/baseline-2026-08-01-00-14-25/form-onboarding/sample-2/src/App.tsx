import SetupWizard from "./components/SetupWizard";

export default function App() {
  return (
    <div className="page">
      <header className="page__header">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <span className="brand__name">Northwind</span>
        </div>
        <p className="page__help">
          Need a hand? <a href="mailto:setup@example.com">setup@example.com</a>
        </p>
      </header>

      <main className="page__main">
        <SetupWizard />
      </main>
    </div>
  );
}
