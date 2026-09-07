import { useState, useEffect } from 'react';
import { usersApi, subscribeToRealtimeStream } from '../services/api';
import { UserProfile } from '../types';

export const useUsers = () => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    const loadUsers = async () => {
      try {
        const list = await usersApi.getAll();
        if (!isCancelled) {
          setUsers(list);
          setLoading(false);
        }
      } catch (err) {
        console.warn("Failed to load users from local API:", err);
        if (!isCancelled) setLoading(false);
      }
    };

    loadUsers();

    const unsubscribe = subscribeToRealtimeStream((eventType, data) => {
      if (isCancelled) return;
      if (eventType === 'user_updated' && data?.uid) {
        setUsers(prev => {
          const exists = prev.some(u => u.uid === data.uid);
          return exists ? prev.map(u => (u.uid === data.uid ? { ...u, ...data } : u)) : [data, ...prev];
        });
      } else if (eventType === 'user_deleted' && data?.uid) {
        setUsers(prev => prev.filter(u => u.uid !== data.uid));
      }
    });

    return () => {
      isCancelled = true;
      unsubscribe();
    };
  }, []);

  const changeUserRole = async (uid: string, newRole: UserProfile['role']) => {
    const updated = await usersApi.update(uid, { role: newRole });
    setUsers(prev => prev.map(u => (u.uid === uid ? { ...u, role: newRole } : u)));
    return updated;
  };

  const removeUser = async (uid: string) => {
    await usersApi.delete(uid);
    setUsers(prev => prev.filter(u => u.uid !== uid));
  };

  return { users, loading, changeUserRole, removeUser };
};
