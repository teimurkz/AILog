import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { useLanguage } from '../../LanguageContext';
import { UserProfile } from '../../types';
import { Shield, User as UserIcon, Check, Settings } from 'lucide-react';
import { cn } from '../../lib/utils';

export const UserManagement = () => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const { t, isRTL } = useLanguage();

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), (snapshot) => {
      setUsers(snapshot.docs.map(d => ({ ...d.data() } as UserProfile)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });
    return unsub;
  }, []);

  const handleRoleChange = async (uid: string, newRole: UserProfile['role']) => {
    try {
      await updateDoc(doc(db, 'users', uid), { role: newRole });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className={cn("flex items-center gap-4 mb-8", isRTL && "flex-row-reverse")}>
        <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center">
          <Settings className="w-6 h-6 text-blue-600" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{t('users')}</h2>
          <p className="text-slate-500">Manage user roles and permissions</p>
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className={cn("bg-slate-50", isRTL && "text-right")}>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">User</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Email</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">{t('role')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((user) => (
              <tr key={user.uid} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4">
                  <div className={cn("flex items-center gap-3", isRTL && "flex-row-reverse")}>
                    <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center">
                      <UserIcon className="w-5 h-5 text-slate-500" />
                    </div>
                    <span className="font-semibold text-slate-900">{user.displayName}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-slate-500">{user.email}</td>
                <td className="px-6 py-4">
                  <select
                    value={user.role}
                    onChange={(e) => handleRoleChange(user.uid, e.target.value as UserProfile['role'])}
                    className={cn(
                      "px-4 py-2 rounded-xl text-sm font-semibold outline-none border transition-all",
                      user.role === 'admin' ? "bg-red-50 text-red-700 border-red-100" :
                      user.role === 'logistics' ? "bg-blue-50 text-blue-700 border-blue-100" :
                      "bg-slate-50 text-slate-700 border-slate-100"
                    )}
                  >
                    <option value="admin">{t('admin')}</option>
                    <option value="logistics">{t('logistics')}</option>
                    <option value="viewer">{t('viewer')}</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
