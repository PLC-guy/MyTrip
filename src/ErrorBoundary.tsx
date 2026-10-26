import { Component, type ReactNode } from 'react'

/**
 * Rete di sicurezza: se una schermata va in errore mentre si disegna, React la
 * smonterebbe lasciando solo lo sfondo, e l'unica via d'uscita sarebbe chiudere
 * l'app. Qui si mostra cosa è successo e si torna ai viaggi. Il dettaglio
 * dell'errore serve a chi corregge l'app.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="page">
        <div className="empty-state">
          <h2>Qualcosa è andato storto</h2>
          <p>Questa schermata non si è aperta. I tuoi viaggi sono al sicuro.</p>
          <button className="btn" onClick={() => (location.hash = '#/')}>
            Torna ai viaggi
          </button>
          <p className="small" style={{ marginTop: 16, wordBreak: 'break-word' }}>
            Dettaglio per la correzione: {error.name}: {error.message}
          </p>
        </div>
      </div>
    )
  }
}
