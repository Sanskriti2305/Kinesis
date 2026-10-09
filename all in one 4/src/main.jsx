import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return (
      <div style={{padding:24,fontFamily:'system-ui',background:'#16181b',color:'#e8a3a3',height:'100vh'}}>
        <h2>Kinesis hit an error</h2>
        <pre style={{whiteSpace:'pre-wrap',marginTop:12}}>{this.state.error.stack || this.state.error.message}</pre>
        <p style={{marginTop:12,color:'#c7cad0'}}>
          During a live demo: click Reload first — most render errors clear on a fresh mount
          without losing the running gesture/AI/collab servers. If it recurs immediately, it's
          a real bug, not a fluke — fix and restart the dev server.
        </p>
        <button
          onClick={() => this.setState({ error: null })}
          style={{marginTop:12,padding:'8px 16px',background:'#35c9b0',color:'#0e1512',border:'none',borderRadius:4,fontWeight:700,cursor:'pointer'}}
        >
          Reload Kinesis
        </button>
      </div>
    );
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </StrictMode>,
)
