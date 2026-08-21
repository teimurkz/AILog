import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { UserProfile } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useUsers } from '../../hooks/useUsers';
import { User as UserIcon, Settings, Lock, Trash2, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

export const UserManagement = () => {
  const { users, loading, changeUserRole, removeUser } = useUsers();
  const { t, isRTL } = useLanguage();
  const { user: currentUser } = useAuth();
  const [userToDelete, setUserToDelete] = React.useState<UserProfile | null>(null);

  const handleRoleChange = async (uid: string, newRole: UserProfile['role']) => {
    await changeUserRole(uid, newRole);
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    try {
      await removeUser(userToDelete.uid);
      setUserToDelete(null);
    } catch (error) {
      console.error('Failed to delete user', error);
    }
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
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">{t('action')}</th>
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
                            user.role === 'regional_manager' ? "bg-purple-50 text-purple-700 border-purple-100" :
                            "bg-slate-50 text-slate-700 border-slate-100"
                          )}
                        >
                          <option value="admin">{t('admin')}</option>
                          <option value="logistics">{t('logistics')}</option>
                          <option value="regional_manager">{t('regionalManager')}</option>
                          <option value="viewer">{t('viewer')}</option>
                        </select>
                        {user.uid === currentUser?.uid && (
                          <Lock className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {user.uid !== currentUser?.uid && (
                        <button
                          onClick={() => setUserToDelete(user)}
                          className="p-2 border border-slate-100 rounded-xl hover:bg-red-50 hover:text-red-600 transition-all"
                          title={t('delete')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete User Confirmation Modal */}
      <AnimatePresence>
        {userToDelete && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden p-6"
            >
              <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center mb-4 mx-auto">
                <AlertCircle className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 text-center mb-2">{t('deleteUser')}</h3>
              <p className="text-slate-500 text-center text-sm mb-6">{t('confirmDeleteUser')}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setUserToDelete(null)}
                  className="flex-1 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors"
                >
                  {t('cancel')}
                </button>
                <button
                  onClick={handleDeleteUser}
                  className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors"
                >
                  {t('delete')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

