import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { UserProfile } from '../types';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  isLogistics: boolean;
  isViewer: boolean;
  isRegionalManager: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      if (u) {
        const userDocRef = doc(db, 'users', u.uid);
        
        // Initial check and creation
        try {
          const docSnap = await getDoc(userDocRef);
          if (!docSnap.exists()) {
            const initialRole = (u.email === 'ti07kz@gmail.com' || u.isAnonymous) ? 'admin' : 'viewer';
            const newProfile: UserProfile = {
              uid: u.uid,
              email: u.email || '',
              displayName: u.displayName || '',
              role: initialRole
            };
            await setDoc(userDocRef, newProfile);
            setProfile(newProfile);
          }
        } catch (err) {
          console.error("Error checking/creating user profile:", err);
        }

        // Subscribe to user profile
        unsubProfile = onSnapshot(userDocRef, async (snap) => {
          if (snap.exists()) {
            const data = snap.data() as UserProfile;
            setProfile(data);
            
            // Auto-heal super admin/demo role
            if ((u.email === 'ti07kz@gmail.com' || u.isAnonymous) && data.role !== 'admin') {
              await updateDoc(userDocRef, { role: 'admin' });
            }
          }
          setLoading(false);
        });
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const value = {
    user,
    profile,
    loading,
    isAdmin: profile?.role === 'admin' || user?.email === 'ti07kz@gmail.com',
    isLogistics: profile?.role === 'logistics' || profile?.role === 'admin' || user?.email === 'ti07kz@gmail.com',
    isViewer: profile?.role === 'viewer' && user?.email !== 'ti07kz@gmail.com',
    isRegionalManager: profile?.role === 'regional_manager' && user?.email !== 'ti07kz@gmail.com'
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
