import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { UserProfile } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useUsers } from '../../hooks/useUsers';
import { User as UserIcon, Settings, Lock } from 'lucide-react';
import { cn } from '../../lib/utils';

export const UserManagement = () => {
  const { users, loading, changeUserRole } = useUsers();
  const { t, isRTL } = useLanguage();
  const { user: currentUser } = useAuth();

  const handleRoleChange = async (uid: string, newRole: UserProfile['role']) => {
    await changeUserRole(uid, newRole);
  };

  if (loading) {
    return (
      <div className="p-12 text-center">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-500 font-medium">Loading users...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className={cn("flex items-center gap-4 mb-8", isRTL && "flex-row-reverse")}>
        <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center">
          <Settings className="w-6 h-6 text-blue-600" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{t('users')}</h2>
          <p className="text-slate-500">
            {users.length} {users.length === 1 ? 'user' : 'users'} registered
          </p>
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
        {users.length === 0 ? (
          <div className="p-12 text-center">
            <UserIcon className="w-12 h-12 text-slate-200 mx-auto mb-4" />
            <p className="text-slate-500 font-medium">No users found</p>
            <p className="text-slate-400 text-sm mt-1">Make sure other users have logged in at least once.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className={cn("bg-slate-50", isRTL && "text-right")}>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">User</th>
                  <th className="px-4 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider hidden sm:table-cell">Email</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">{t('role')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((user) => (
                  <tr key={user.uid} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className={cn("flex items-center gap-3", isRTL && "flex-row-reverse")}>
                        <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center shrink-0">
                          <UserIcon className="w-5 h-5 text-slate-500" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 truncate">{user.displayName}</p>
                          <p className="text-xs text-slate-500 sm:hidden truncate">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-500 hidden sm:table-cell">{user.email}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <select
                          value={user.role}
                          disabled={user.uid === currentUser?.uid}
                          onChange={(e) => handleRoleChange(user.uid, e.target.value as UserProfile['role'])}
                          className={cn(
                            "px-4 py-2 rounded-xl text-sm font-semibold outline-none border transition-all w-full sm:w-auto",
                            user.uid === currentUser?.uid ? "opacity-60 cursor-not-allowed bg-slate-100 text-slate-500 border-slate-200" :
                            user.role === 'admin' ? "bg-red-50 text-red-700 border-red-100" :
                            user.role === 'logistics' ? "bg-blue-50 text-blue-700 border-blue-100" :
                            "bg-slate-50 text-slate-700 border-slate-100"
                          )}
                        >
                          <option value="admin">{t('admin')}</option>
                          <option value="logistics">{t('logistics')}</option>
                          <option value="viewer">{t('viewer')}</option>
                        </select>
                        {user.uid === currentUser?.uid && (
                          <Lock className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

