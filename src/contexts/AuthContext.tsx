import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { onIdTokenChanged, signOut, type User } from 'firebase/auth';
import { doc, onSnapshot, runTransaction } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { canEditSection, canViewSection, effectiveAccess, effectiveRole, isOwnerIdentity, type AccessMap, type CrmSection } from '../../shared/access-policy';
import { UserProfile } from '../types';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  authError: string | null;
  isAdmin: boolean;
  isLogistics: boolean;
  isViewer: boolean;
  isRegionalManager: boolean;
  /** Sections this user may open / change (set by the administrator, otherwise by role). */
  access: AccessMap;
  canView: (section: CrmSection) => boolean;
  canEdit: (section: CrmSection) => boolean;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}
const AuthContext = createContext<AuthContextType | undefined>(undefined);
export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [access, setAccess] = useState<AccessMap>({});
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  useEffect(() => {
    let unsubscribeProfile: (() => void) | undefined;
    let generation = 0;
    const unsubscribeAuth = onIdTokenChanged(auth, async current => {
      const version = ++generation;
      unsubscribeProfile?.();
      setUser(current); setProfile(null); setAccess({}); setAuthError(null); setLoading(Boolean(current));
      if (!current) return;
      const ref = doc(db, 'users', current.uid);
      try {
        // Create only absent profiles. Existing roles, names and extra fields stay intact.
        await runTransaction(db, async transaction => {
          const existing = await transaction.get(ref);
          if (!existing.exists()) transaction.set(ref, {
            uid: current.uid, email: current.email || '',
            displayName: current.displayName || (current.isAnonymous ? 'Гость' : ''),
            role: isOwnerIdentity(current) ? 'admin' : 'viewer'
          });
        });
        if (version !== generation) return;
        unsubscribeProfile = onSnapshot(ref, snapshot => {
          if (version !== generation) return;
          const data = snapshot.exists() ? snapshot.data() : {};
          setProfile({ ...data, uid: current.uid, email: current.email || '',
            displayName: data.displayName || current.displayName || (current.isAnonymous ? 'Гость' : ''),
            role: effectiveRole(current, data.role) } as UserProfile);
          setAccess(effectiveAccess(current, data.role, data.access));
          setLoading(false);
        }, () => {
          if (version !== generation) return;
          setAuthError('Не удалось загрузить профиль Firebase. Проверьте подключение и повторите вход.');
          setLoading(false);
        });
      } catch {
        if (version !== generation) return;
        setAuthError('Не удалось загрузить профиль Firebase. Данные пользователя не изменены.');
        setLoading(false);
      }
    });
    return () => { generation++; unsubscribeAuth(); unsubscribeProfile?.(); };
  }, []);
  const refreshSession = useCallback(async () => { await auth.currentUser?.getIdToken(true); }, []);
  const logout = async () => { await signOut(auth); };
  return <AuthContext.Provider value={{ user, profile, loading, authError,
    isAdmin: Boolean(user && isOwnerIdentity(user)),
    isLogistics: profile?.role === 'logistics' || profile?.role === 'admin',
    isViewer: profile?.role === 'viewer', isRegionalManager: profile?.role === 'regional_manager',
    access, canView: section => canViewSection(access, section), canEdit: section => canEditSection(access, section),
    logout, refreshSession }}>{children}</AuthContext.Provider>;
};
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
