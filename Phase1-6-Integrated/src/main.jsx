import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return <div style={{padding:24,fontFamily:'system-ui',background:'#16181b',color:'#e8a3a3',height:'100vh'}}><h2>Kinesis startup error</h2><pre style={{whiteSpace:'pre-wrap',marginTop:12}}>{this.state.error.stack || this.state.error.message}</pre><p style={{marginTop:12,color:'#c7cad0'}}>Restart the dev server after fixing the reported error.</p></div>;
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </StrictMode>,
)
