import React, { useState } from 'react';

interface Props { onLogin: (u: string, p: string) => Promise<void>; }

export default function LoginPage({ onLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      await onLogin(username, password);
    } catch {
      setError('Username atau password salah.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-root">
      <div className="login-card">
        <div className="login-logo">
          <div className="icon">🌊</div>
          <h1>SIG-PANTAU TSUNAMI</h1>
          <p>Sistem Deteksi Dini Anomali Muka Air Laut<br/>Panjang, Bandar Lampung</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">USERNAME</label>
            <input className="form-input" value={username}
              onChange={e => setUsername(e.target.value)} required autoFocus />
          </div>
          <div className="form-group">
            <label className="form-label">PASSWORD</label>
            <input className="form-input" type="password" value={password}
              onChange={e => setPassword(e.target.value)} required />
          </div>
          {error && <div className="login-error">{error}</div>}
          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? 'MASUK...' : '🔐 MASUK'}
          </button>
        </form>
        <div className="login-hint">
          Demo: admin / admin123 · supervisor1 / super123 · operator1 / oper123
        </div>
      </div>
    </div>
  );
}
