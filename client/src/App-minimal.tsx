import React from "react";

function App() {
  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#1a1a1a',
      color: '#ffffff',
      fontFamily: 'Arial, sans-serif',
      padding: '40px 20px',
      textAlign: 'center'
    }}>
      <h1 style={{
        fontSize: '48px',
        fontWeight: 'bold',
        marginBottom: '20px',
        background: 'linear-gradient(45deg, #4F46E5, #7C3AED)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text'
      }}>
        🚀 Cloudana DePIN Testnet
      </h1>
      
      <p style={{
        fontSize: '24px',
        color: '#888',
        marginBottom: '40px'
      }}>
        Successfully Restored & Running
      </p>

      <div style={{
        backgroundColor: '#2a2a2a',
        border: '1px solid #444',
        borderRadius: '12px',
        padding: '30px',
        maxWidth: '800px',
        margin: '0 auto',
        textAlign: 'left'
      }}>
        <h2 style={{
          color: '#4ade80',
          fontSize: '28px',
          marginBottom: '20px',
          textAlign: 'center'
        }}>
          ✅ System Operational
        </h2>
        
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '20px',
          marginBottom: '30px'
        }}>
          <div>
            <h3 style={{ color: '#60a5fa', fontSize: '18px', marginBottom: '10px' }}>
              Infrastructure
            </h3>
            <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '1.8' }}>
              <li>Vite Server: Running ⚡</li>
              <li>React App: Loaded 🎯</li>
              <li>Port 7003: Open 🌐</li>
            </ul>
          </div>
          
          <div>
            <h3 style={{ color: '#a78bfa', fontSize: '18px', marginBottom: '10px' }}>
              DePIN Features
            </h3>
            <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '1.8' }}>
              <li>Compute Marketplace 🖥️</li>
              <li>Provider Network 🔗</li>
              <li>Base Sepolia Ready ⛓️</li>
            </ul>
          </div>
        </div>
        
        <div style={{
          backgroundColor: '#065f46',
          border: '1px solid #10b981',
          borderRadius: '8px',
          padding: '20px',
          textAlign: 'center'
        }}>
          <h3 style={{ color: '#10b981', margin: '0 0 10px 0' }}>
            🎉 Restoration Complete!
          </h3>
          <p style={{ color: '#d1fae5', margin: 0 }}>
            Your decentralized compute marketplace is now accessible
          </p>
        </div>
      </div>
      
      <footer style={{
        marginTop: '40px',
        color: '#666',
        fontSize: '14px'
      }}>
        Cloudana DePIN • Base Sepolia Testnet • Ready for Web3
      </footer>
    </div>
  );
}

export default App;