import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserProfile } from '../types';
import { usersApi } from '../services/api';

interface AuthContextType {
  user: { uid: string; email: string; displayName: string } | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  isLogistics: boolean;
  isViewer: boolean;
  isRegionalManager: boolean;
  switchRole: (role: UserProfile['role']) => void;
}

const DEFAULT_PROFILE: UserProfile = {
  uid: 'admin_local',
  email: 'ti07kz@gmail.com',
  displayName: 'Главный Администратор',
  role: 'admin'
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [profile, setProfile] = useState<UserProfile>(() => {
    try {
      const saved = localStorage.getItem('local_user_profile');
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEFAULT_PROFILE;
  });

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Sync with local backend users if available
    usersApi.getById(profile.uid)
      .then(fetched => {
        if (fetched) {
          setProfile(fetched);
          localStorage.setItem('local_user_profile', JSON.stringify(fetched));
        }
      })
      .catch(() => {
        // Fallback to local default profile
      });
  }, []);

  const switchRole = (role: UserProfile['role']) => {
    const updated = { ...profile, role };
    setProfile(updated);
    localStorage.setItem('local_user_profile', JSON.stringify(updated));
    usersApi.update(profile.uid, { role }).catch(() => {});
  };

  const user = {
    uid: profile.uid,
    email: profile.email,
    displayName: profile.displayName
  };

  const value = {
    user,
    profile,
    loading,
    isAdmin: profile.role === 'admin' || profile.email === 'ti07kz@gmail.com',
    isLogistics: profile.role === 'logistics' || profile.role === 'admin' || profile.email === 'ti07kz@gmail.com',
    isViewer: profile.role === 'viewer' && profile.email !== 'ti07kz@gmail.com',
    isRegionalManager: profile.role === 'regional_manager' && profile.email !== 'ti07kz@gmail.com',
    switchRole
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
