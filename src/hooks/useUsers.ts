import { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { UserProfile } from '../types';

export const useUsers = () => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), (snapshot) => {
      setUsers(snapshot.docs.map(d => ({ ...d.data() } as UserProfile)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
      setLoading(false);
    });
    return unsub;
  }, []);

  const changeUserRole = async (uid: string, newRole: UserProfile['role']) => {
    try {
      await updateDoc(doc(db, 'users', uid), { role: newRole });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
      throw error;
    }
  };

  return { users, loading, changeUserRole };
};
