import { useState, useEffect } from 'react';

interface AuthSession {
  user: string;
  loggedIn: boolean;
  loginTime: string;
}

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [user, setUser] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = () => {
    try {
      const sessionData = localStorage.getItem('auth_session');
      if (sessionData) {
        const session: AuthSession = JSON.parse(sessionData);
        
        // Check if session is valid (within 7 days)
        const loginTime = new Date(session.loginTime);
        const now = new Date();
        const daysDiff = (now.getTime() - loginTime.getTime()) / (1000 * 60 * 60 * 24);
        
        if (session.loggedIn && daysDiff < 7) {
          setIsAuthenticated(true);
          setUser(session.user);
        } else {
          // Session expired
          localStorage.removeItem('auth_session');
          setIsAuthenticated(false);
          setUser(null);
        }
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
      localStorage.removeItem('auth_session');
      setIsAuthenticated(false);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const login = (username: string) => {
    setIsAuthenticated(true);
    setUser(username);
  };

  const logout = () => {
    localStorage.removeItem('auth_session');
    setIsAuthenticated(false);
    setUser(null);
  };

  return {
    isAuthenticated,
    user,
    isLoading,
    login,
    logout
  };
}