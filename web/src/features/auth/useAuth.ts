import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMasterAuthStore, type AuthUser } from '@/store';
import { accountsMasterApi } from '@/shared/api/master/accounts';

export function useAuth() {
  const { token, user, setAuth, clearAuth } = useMasterAuthStore();
  const navigate = useNavigate();

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await accountsMasterApi.login({ email, password });
      setAuth(res.token, {
        id: res.account.id,
        email: res.account.email,
        role: res.account.role,
      } as AuthUser);
      navigate('/master/dashboard', { replace: true });
    },
    [setAuth, navigate]
  );

  const logout = useCallback(() => {
    clearAuth();
    navigate('/master/login', { replace: true });
  }, [clearAuth, navigate]);

  return {
    isAuthenticated: Boolean(token),
    token,
    user,
    login,
    logout,
  };
}
