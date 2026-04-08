import React, { useState, useEffect } from 'react';
import { Package, Eye, EyeOff, User, Lock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useCompanySettings } from '../hooks/useCompanySettings';

// Main App Component
// This component manages the overall login state and checks for an active session.
export default function App() {
  const [loggedInUser, setLoggedInUser] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Check for an active session when the component first loads
  useEffect(() => {
    try {
      const sessionData = sessionStorage.getItem('auth_session');
      if (sessionData) {
        const session = JSON.parse(sessionData);
        // If a valid session exists, set the user as logged in
        if (session && session.loggedIn && session.user) {
          setLoggedInUser(session.user);
        }
      }
    } catch (error) {
      console.error("Failed to parse session data:", error);
      sessionStorage.removeItem('auth_session'); // Clear potentially corrupted data
    } finally {
      // Signal that the authentication check is complete
      setIsAuthReady(true);
    }
  }, []);

  const handleLogin = (username) => {
    setLoggedInUser(username);
  };

  const handleLogout = () => {
    // Clear the session data and update the state
    sessionStorage.removeItem('auth_session');
    setLoggedInUser(null);
  };

  // Display a loading indicator until the session check is finished
  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-2 border-slate-600 border-t-blue-500"></div>
          <p className="text-slate-400 text-sm tracking-wide">Initializing Portal...</p>
        </div>
      </div>
    );
  }

  // Render the Dashboard if logged in, otherwise show the Login page
  return (
    <div>
      {loggedInUser ? (
        <DashboardPage username={loggedInUser} onLogout={handleLogout} />
      ) : (
        <LoginPage onLogin={handleLogin} />
      )}
    </div>
  );
}


// Login Page Component
export function LoginPage({ onLogin }) {
  const { settings: co } = useCompanySettings();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      // Query the users table from Supabase
      const { data, error: queryError } = await supabase
        .from('users')
        .select('username, password')
        .eq('username', username)
        .maybeSingle();

      if (queryError) {
        console.error('Database error:', queryError);
        setError('An error occurred. Please try again.');
        setIsLoading(false);
        return;
      }

      // Check if user exists and password matches
      if (data && data.password === password) {
        sessionStorage.setItem('auth_session', JSON.stringify({
          user: username,
          loggedIn: true,
          loginTime: new Date().toISOString()
        }));

        onLogin(username);
      } else {
        setError('Invalid username or password');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('An error occurred. Please try again.');
    }

    setIsLoading(false);
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center font-sans p-4 overflow-hidden bg-slate-950">
      <img
        src="https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=1920&q=85"
        alt="Warehouse with parcel boxes"
        className="absolute inset-0 h-full w-full object-cover opacity-70"
      />
      <div className="absolute inset-0 bg-slate-950/65" />
      <div className="absolute inset-0 bg-blue-950/25" />

      <div className="pointer-events-none absolute bottom-6 left-6 z-10 hidden max-w-xs rounded-lg border border-white/20 bg-white/10 p-4 text-white shadow-lg backdrop-blur-sm md:block">
        <div className="text-xs font-semibold uppercase tracking-wide text-blue-100">Client Installations</div>
        <div className="mt-3 space-y-2 text-sm font-semibold">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-blue-200" />
            Suny Medicare LLP
          </div>
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-blue-200" />
            Shivshakti Distributors
          </div>
        </div>
      </div>

      <div
        className="relative z-10 w-full max-w-md rounded-2xl bg-white/95 p-10 backdrop-blur-sm"
        style={{ boxShadow: '0 24px 80px rgba(15,23,42,0.35)' }}
      >
        {/* Logo + Brand */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', boxShadow: '0 6px 20px rgba(59,130,246,0.35)' }}
          >
            <Package className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{co.company_name}</h1>
          <p className="text-sm mt-1" style={{ color: '#3b82f6' }}>Parcel Portal</p>
        </div>

        {/* Divider */}
        <div className="border-t border-gray-100 mb-8" />

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Username */}
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1.5">
              Username
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <User className="w-4 h-4 text-gray-400" />
              </div>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="off"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                className="w-full pl-10 pr-4 py-3 rounded-xl text-sm text-gray-900 placeholder-gray-400 outline-none transition-all bg-gray-50"
                style={{ border: '1.5px solid #e5e7eb' }}
                onFocus={(e) => { e.target.style.border = '1.5px solid #3b82f6'; e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)'; e.target.style.backgroundColor = '#fff'; }}
                onBlur={(e) => { e.target.style.border = '1.5px solid #e5e7eb'; e.target.style.boxShadow = 'none'; e.target.style.backgroundColor = '#f9fafb'; }}
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">
              Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Lock className="w-4 h-4 text-gray-400" />
              </div>
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full pl-10 pr-10 py-3 rounded-xl text-sm text-gray-900 placeholder-gray-400 outline-none transition-all bg-gray-50"
                style={{ border: '1.5px solid #e5e7eb' }}
                onFocus={(e) => { e.target.style.border = '1.5px solid #3b82f6'; e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)'; e.target.style.backgroundColor = '#fff'; }}
                onBlur={(e) => { e.target.style.border = '1.5px solid #e5e7eb'; e.target.style.boxShadow = 'none'; e.target.style.backgroundColor = '#f9fafb'; }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-xl px-4 py-3 text-sm text-red-600 bg-red-50" style={{ border: '1px solid #fecaca' }}>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3.5 rounded-xl text-sm font-semibold text-white transition-all duration-200 flex items-center justify-center gap-2"
            style={{
              background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.75 : 1,
              boxShadow: isLoading ? 'none' : '0 4px 16px rgba(59,130,246,0.4)',
            }}
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                Authenticating...
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-gray-400">
          &copy; 2025 RishWin Innovations
        </p>
      </div>
    </div>
  );
}
