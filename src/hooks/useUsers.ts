import { useFirestoreCollection } from './useFirestoreCollection';
import { usersApi } from '../services/api';
import type { UserProfile } from '../types';

export const useUsers = () => {
  const { data: users, ...state } = useFirestoreCollection<UserProfile>('users');
  const changeUserRole = (uid: string, role: UserProfile['role']) => usersApi.update(uid, { role });
  const removeUser = (uid: string) => usersApi.delete(uid);
  return { users, ...state, changeUserRole, removeUser };
};
