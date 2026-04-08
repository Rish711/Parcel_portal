import React, { useState } from 'react';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { Settings, Package, Download, Trash2, Calendar, CalendarRange, Users, UserPlus, Key, Bell, AlertTriangle, Building2, Save } from 'lucide-react';
import { useCompanySettings } from '../hooks/useCompanySettings';

interface SettingsTabProps {
  currentUser?: string;
}

export function SettingsTab({ currentUser = '' }: SettingsTabProps) {
  const { dialogState, openConfirmDialog, handleConfirm, handleCancel } = useConfirmDialog();
  const canManageDeveloperNotice = currentUser.toLowerCase() === 'rish';
  const [activeSubTab, setActiveSubTab] = useState<'backup' | 'delete' | 'users' | 'notice' | 'company'>('backup');

  // Company settings
  const { settings: coDefaults, loading: coSettingsLoading, refresh: refreshCompanySettings } = useCompanySettings();
  const [coName, setCoName] = useState('');
  const [coDeptPhone, setCoDeptPhone] = useState('');
  const [coHeadPhones, setCoHeadPhones] = useState('');
  const [coAddress, setCoAddress] = useState('');
  const [coEmail, setCoEmail] = useState('');
  const [coLoading, setCoLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [deletePayload, setDeletePayload] = useState<{
    tableName: string;
    displayName: string;
    monthName: string;
  } | null>(null);

  const [users, setUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [modalNewPassword, setModalNewPassword] = useState('');
  const [modalConfirmPassword, setModalConfirmPassword] = useState('');
  const [modalPasswordError, setModalPasswordError] = useState('');
  const [modalConfirmPasswordError, setModalConfirmPasswordError] = useState('');
  const [noticeId, setNoticeId] = useState<string | null>(null);
  const [noticeTitle, setNoticeTitle] = useState('AMC Payment Required');
  const [noticeMessage, setNoticeMessage] = useState('Please pay the pending AMC to continue using this app. Service support and app access may be stopped in 2 weeks if the AMC is not renewed.');
  const [noticeContactText, setNoticeContactText] = useState('Contact RishWin Innovations for renewal.');
  const [noticeButtonText, setNoticeButtonText] = useState('I Understand');
  const [noticeSeverity, setNoticeSeverity] = useState<'info' | 'warning' | 'danger'>('danger');
  const [noticeActive, setNoticeActive] = useState(false);
  const [noticeShutdownDate, setNoticeShutdownDate] = useState(format(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'));
  const [loadingNotice, setLoadingNotice] = useState(false);

  // Populate company form whenever DB data loads (skips while loading to avoid FALLBACK values)
  React.useEffect(() => {
    if (!coSettingsLoading) {
      setCoName(coDefaults.company_name);
      setCoDeptPhone(coDefaults.parcel_dept_phone);
      setCoHeadPhones(coDefaults.dept_head_phones);
      setCoAddress(coDefaults.address);
      setCoEmail(coDefaults.email);
    }
  }, [coDefaults, coSettingsLoading]);

  const handleSaveCompanySettings = async () => {
    if (!coName.trim()) { toast.error('Company name is required'); return; }
    if (!coDeptPhone.trim()) { toast.error('Parcel Dept phone is required'); return; }
    setCoLoading(true);
    try {
      const { error } = await supabase
        .from('company_settings')
        .update({
          company_name: coName.trim(),
          parcel_dept_phone: coDeptPhone.trim(),
          dept_head_phones: coHeadPhones.trim(),
          address: coAddress.trim(),
          email: coEmail.trim(),
        })
        .eq('id', 1);
      if (error) throw error;
      toast.success('Company details saved');
      refreshCompanySettings();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save');
    } finally {
      setCoLoading(false);
    }
  };

  const renderCompanyTab = () => (
    <div className="max-w-lg space-y-4">
      <p className="text-sm text-gray-500">
        These details appear on printed reports (Party List, History, Party Ledger, Courier Bill).
      </p>
      {[
        { label: 'Company Name', value: coName, set: setCoName, placeholder: 'e.g. Suny Medicare LLP', required: true },
        { label: 'Parcel Dept Phone', value: coDeptPhone, set: setCoDeptPhone, placeholder: 'e.g. 7028502799', required: true },
        { label: 'Dept Head Phones', value: coHeadPhones, set: setCoHeadPhones, placeholder: 'e.g. 8600519999, 7083169357', required: false },
        { label: 'Address', value: coAddress, set: setCoAddress, placeholder: 'e.g. Kolhapur, Maharashtra', required: false },
        { label: 'Email', value: coEmail, set: setCoEmail, placeholder: 'e.g. info@example.com', required: false },
      ].map(({ label, value, set, placeholder, required }) => (
        <div key={label}>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
            {label}{required && <span className="text-red-400 ml-0.5">*</span>}
          </label>
          <input
            type="text"
            value={value}
            onChange={(e) => set(e.target.value)}
            placeholder={placeholder}
            className="w-full h-10 px-3 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      ))}
      <button
        onClick={handleSaveCompanySettings}
        disabled={coLoading}
        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        <Save className="w-4 h-4" />
        {coLoading ? 'Saving...' : 'Save Changes'}
      </button>
    </div>
  );

  const handleBackupPartyListMonthly = async () => {
    if (!selectedMonth) {
      toast.error('Please select a month');
      return;
    }
    toast.loading('Exporting monthly party list data...', { id: 'backup-export' });
    try {
      const startDate = new Date(selectedMonth + '-01');
      const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
      endDate.setHours(23, 59, 59, 999);
      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await supabase
          .from('party_list')
          .select(`*, party_info:party_information(*), courier_agency:courier_agency_list(*)`)
          .gte('created_at', startDate.toISOString())
          .lte('created_at', endDate.toISOString())
          .order('created_at', { ascending: false })
          .range(from, from + batchSize - 1);
        if (error) throw error;
        if (data && data.length > 0) {
          allData = [...allData, ...data];
          from += batchSize;
          hasMore = data.length === batchSize;
        } else {
          hasMore = false;
        }
      }
      const csv = [
        ['Date', 'Party Code', 'Party Name', 'Address', 'Bill Numbers', 'Courier Agency', 'Boxes'],
        ...allData.map(entry => [
          new Date(entry.date).toLocaleDateString(),
          entry.party_code,
          entry.party_info?.party_name || 'Unknown',
          entry.party_info?.address || 'No address',
          entry.bill_numbers?.join('; ') || '',
          entry.courier_agency?.agency_name || 'Unknown',
          entry.boxes || 0
        ])
      ].map(row => row.join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `party_list_monthly_${selectedMonth.replace('-', '_')}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success(`Exported ${allData.length} party list records for ${selectedMonth}`, { id: 'backup-export' });
    } catch (error) {
      console.error('Backup error:', error);
      toast.error('Failed to backup party list data', { id: 'backup-export' });
    }
  };

  const handleBackupPartyListDaily = async () => {
    if (!selectedDate) {
      toast.error('Please select a date');
      return;
    }
    toast.loading('Exporting daily party list data...', { id: 'backup-export' });
    try {
      const startDate = new Date(selectedDate);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(selectedDate);
      endDate.setHours(23, 59, 59, 999);

      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await supabase
          .from('party_list')
          .select(`*, party_info:party_information(*), courier_agency:courier_agency_list(*)`)
          .gte('created_at', startDate.toISOString())
          .lte('created_at', endDate.toISOString())
          .order('created_at', { ascending: false })
          .range(from, from + batchSize - 1);
        if (error) throw error;
        if (data && data.length > 0) {
          allData = [...allData, ...data];
          from += batchSize;
          hasMore = data.length === batchSize;
        } else {
          hasMore = false;
        }
      }
      const csv = [
        ['Date', 'Party Code', 'Party Name', 'Address', 'Bill Numbers', 'Courier Agency', 'Boxes'],
        ...allData.map(entry => [
          new Date(entry.date).toLocaleDateString(),
          entry.party_code,
          entry.party_info?.party_name || 'Unknown',
          entry.party_info?.address || 'No address',
          entry.bill_numbers?.join('; ') || '',
          entry.courier_agency?.agency_name || 'Unknown',
          entry.boxes || 0
        ])
      ].map(row => row.join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `party_list_daily_${selectedDate.replace(/-/g, '_')}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success(`Exported ${allData.length} party list records for ${format(new Date(selectedDate), 'MMM dd, yyyy')}`, { id: 'backup-export' });
    } catch (error) {
      console.error('Backup error:', error);
      toast.error('Failed to backup party list data', { id: 'backup-export' });
    }
  };

  const handleDeleteData = async (tableName: string, displayName: string) => {
    if (!selectedMonth) {
      toast.error('Please select a month');
      return;
    }

    const monthName = format(new Date(selectedMonth + '-01'), 'MMMM yyyy');

    const confirmed = await openConfirmDialog({
      title: 'Delete Monthly Data',
      message: `Are you sure you want to delete ALL ${displayName} data for ${monthName}?\n\nThis action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger'
    });

    if (!confirmed) return;

    setDeletePayload({ tableName, displayName, monthName });
    setShowDeleteConfirm(true);
  };

  const executeFinalDelete = async () => {
    if (!deletePayload) return;

    const { tableName, displayName, monthName } = deletePayload;
    const toastId = toast.loading(`Deleting ${displayName} data for ${monthName}...`);

    try {
      const startDate = new Date(selectedMonth + '-01');
      const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
      endDate.setHours(23, 59, 59, 999);

      const { error } = await supabase
        .from(tableName)
        .delete()
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString());

      if (error) throw error;

      toast.success(`${displayName} data for ${monthName} has been permanently deleted.`, { id: toastId });
    } catch (error) {
      console.error(`Deletion error for ${tableName}:`, error);
      toast.error(`Failed to delete ${displayName} data.`, { id: toastId });
    } finally {
      setShowDeleteConfirm(false);
      setDeleteConfirmInput('');
      setDeletePayload(null);
    }
  };

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, username, created_at')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUsers(data || []);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Failed to load users');
    } finally {
      setLoadingUsers(false);
    }
  };

  React.useEffect(() => {
    if (activeSubTab === 'users') {
      fetchUsers();
    }
    if (activeSubTab === 'notice' && canManageDeveloperNotice) {
      fetchNotice();
    }
  }, [activeSubTab, canManageDeveloperNotice]);

  React.useEffect(() => {
    if (activeSubTab === 'notice' && !canManageDeveloperNotice) {
      setActiveSubTab('backup');
    }
  }, [activeSubTab, canManageDeveloperNotice]);

  const fetchNotice = async () => {
    setLoadingNotice(true);
    try {
      const { data, error } = await supabase
        .from('app_notices')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        if (error.code === '42P01') {
          toast.error('app_notices table missing. Run 20260408130000_add_app_notices.sql first.');
          return;
        }
        throw error;
      }

      if (!data) return;

      setNoticeId(data.id);
      setNoticeTitle(data.title || 'AMC Payment Required');
      setNoticeMessage(data.message || '');
      setNoticeContactText(data.contact_text || '');
      setNoticeButtonText(data.button_text || 'I Understand');
      setNoticeSeverity(data.severity || 'danger');
      setNoticeActive(Boolean(data.active));
      setNoticeShutdownDate(data.shutdown_date || '');
    } catch (error) {
      console.error('Error fetching developer notice:', error);
      toast.error('Failed to load developer notice');
    } finally {
      setLoadingNotice(false);
    }
  };

  const handleSaveNotice = async () => {
    if (!noticeTitle.trim()) {
      toast.error('Please enter a notice title');
      return;
    }

    if (!noticeMessage.trim()) {
      toast.error('Please enter a notice message');
      return;
    }

    const toastId = toast.loading('Saving developer notice...');
    const noticePayload = {
      title: noticeTitle.trim(),
      message: noticeMessage.trim(),
      contact_text: noticeContactText.trim() || null,
      button_text: noticeButtonText.trim() || 'I Understand',
      severity: noticeSeverity,
      active: noticeActive,
      shutdown_date: noticeShutdownDate || null,
      updated_at: new Date().toISOString()
    };

    try {
      if (noticeId) {
        const { error } = await supabase
          .from('app_notices')
          .update(noticePayload)
          .eq('id', noticeId);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('app_notices')
          .insert([noticePayload])
          .select('id')
          .single();

        if (error) throw error;
        setNoticeId(data.id);
      }

      toast.success(noticeActive ? 'Notice saved and active' : 'Notice saved but inactive', { id: toastId });
    } catch (error) {
      console.error('Error saving developer notice:', error);
      toast.error('Failed to save developer notice', { id: toastId });
    }
  };

  const validateUsername = (username: string) => {
    if (username.length < 3 || username.length > 20) {
      setUsernameError('Username must be between 3 and 20 characters');
      return false;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setUsernameError('Username can only contain letters, numbers, and underscores');
      return false;
    }
    setUsernameError('');
    return true;
  };

  const validatePassword = (password: string) => {
    if (password.length < 4) {
      setPasswordError('Password must be at least 4 characters');
      return false;
    }
    setPasswordError('');
    return true;
  };

  const validateConfirmPassword = (password: string, confirm: string) => {
    if (password !== confirm) {
      setConfirmPasswordError('Passwords do not match');
      return false;
    }
    setConfirmPasswordError('');
    return true;
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();

    const isUsernameValid = validateUsername(newUsername);
    const isPasswordValid = validatePassword(newPassword);
    const isConfirmValid = validateConfirmPassword(newPassword, confirmPassword);

    if (!isUsernameValid || !isPasswordValid || !isConfirmValid) {
      return;
    }

    if (users.length >= 5) {
      toast.error('Maximum limit of 5 users reached');
      return;
    }

    const toastId = toast.loading('Creating user...');

    try {
      const { data: existingUser } = await supabase
        .from('users')
        .select('username')
        .eq('username', newUsername)
        .maybeSingle();

      if (existingUser) {
        setUsernameError('Username already exists');
        toast.error('Username already exists', { id: toastId });
        return;
      }

      const { error } = await supabase
        .from('users')
        .insert([{ username: newUsername, password: newPassword }]);

      if (error) throw error;

      toast.success('User created successfully', { id: toastId });
      setNewUsername('');
      setNewPassword('');
      setConfirmPassword('');
      fetchUsers();
    } catch (error) {
      console.error('Error creating user:', error);
      toast.error('Failed to create user', { id: toastId });
    }
  };

  const handleChangePassword = async () => {
    if (modalNewPassword.length < 4) {
      setModalPasswordError('Password must be at least 4 characters');
      return;
    }
    if (modalNewPassword !== modalConfirmPassword) {
      setModalConfirmPasswordError('Passwords do not match');
      return;
    }

    const toastId = toast.loading('Changing password...');

    try {
      const { error } = await supabase
        .from('users')
        .update({ password: modalNewPassword, updated_at: new Date().toISOString() })
        .eq('username', selectedUser);

      if (error) throw error;

      toast.success('Password changed successfully', { id: toastId });
      setShowChangePasswordModal(false);
      setSelectedUser(null);
      setModalNewPassword('');
      setModalConfirmPassword('');
      setModalPasswordError('');
      setModalConfirmPasswordError('');
    } catch (error) {
      console.error('Error changing password:', error);
      toast.error('Failed to change password', { id: toastId });
    }
  };

  const renderUsersTab = () => (
    <div className="space-y-6">
      <div className="p-4 bg-green-50 rounded-lg border border-green-200">
        <div className="flex items-center gap-2 mb-4">
          <UserPlus className="w-5 h-5 text-green-600" />
          <h4 className="font-medium text-green-900">Create New User</h4>
        </div>
        {users.length >= 5 ? (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-md">
            <p className="text-amber-800 font-medium">
              Maximum limit reached (5 users)
            </p>
          </div>
        ) : (
          <form onSubmit={handleCreateUser} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-green-800 mb-2">
                Username
              </label>
              <input
                type="text"
                value={newUsername}
                onChange={(e) => {
                  setNewUsername(e.target.value);
                  setUsernameError('');
                }}
                onBlur={() => validateUsername(newUsername)}
                className="w-full px-3 py-2 border border-green-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                placeholder="Enter username (3-20 characters)"
                required
              />
              {usernameError && (
                <p className="text-red-600 text-xs mt-1">{usernameError}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-green-800 mb-2">
                Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setPasswordError('');
                }}
                onBlur={() => validatePassword(newPassword)}
                className="w-full px-3 py-2 border border-green-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                placeholder="Enter password (minimum 4 characters)"
                required
              />
              {passwordError && (
                <p className="text-red-600 text-xs mt-1">{passwordError}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-green-800 mb-2">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setConfirmPasswordError('');
                }}
                onBlur={() => validateConfirmPassword(newPassword, confirmPassword)}
                className="w-full px-3 py-2 border border-green-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                placeholder="Confirm password"
                required
              />
              {confirmPasswordError && (
                <p className="text-red-600 text-xs mt-1">{confirmPasswordError}</p>
              )}
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 flex items-center gap-2"
            >
              <UserPlus className="w-4 h-4" />
              Create User
            </button>
          </form>
        )}
      </div>

      <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            <h4 className="font-medium text-blue-900">User List</h4>
          </div>
          <div className={`text-sm font-medium ${users.length >= 4 ? 'text-amber-700' : 'text-blue-700'}`}>
            {users.length} of 5 users
          </div>
        </div>

        {loadingUsers ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : users.length === 0 ? (
          <p className="text-blue-700 text-center py-4">No users found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-blue-200">
                  <th className="text-left py-2 px-3 text-blue-900 font-medium">Username</th>
                  <th className="text-left py-2 px-3 text-blue-900 font-medium">Created Date</th>
                  <th className="text-right py-2 px-3 text-blue-900 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-blue-100 hover:bg-blue-100">
                    <td className="py-2 px-3 text-blue-900">{user.username}</td>
                    <td className="py-2 px-3 text-blue-700">
                      {format(new Date(user.created_at), 'MMM dd, yyyy')}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={() => {
                          setSelectedUser(user.username);
                          setShowChangePasswordModal(true);
                        }}
                        className="px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm flex items-center gap-1 ml-auto"
                      >
                        <Key className="w-3 h-3" />
                        Change Password
                      </button>
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

  const renderBackupTab = () => (
    <div className="space-y-6">
      <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-5 h-5 text-blue-600" />
          <h4 className="font-medium text-blue-900">Daily Backup</h4>
        </div>
        <p className="text-sm text-blue-700 mb-4">
          Download party list data for a specific date as CSV file for backup purposes.
        </p>
        <div className="mb-4">
          <label className="block text-sm font-medium text-blue-800 mb-2">
            Select Date:
          </label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-full px-3 py-2 border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <p className="text-xs text-blue-600 mt-2">
            Selected: {selectedDate ? format(new Date(selectedDate), 'MMMM dd, yyyy') : 'None'}
          </p>
        </div>
        <button
          onClick={handleBackupPartyListDaily}
          disabled={!selectedDate}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          Backup Daily Data ({selectedDate ? format(new Date(selectedDate), 'MMM dd, yyyy') : 'Select Date'})
        </button>
      </div>

      <div className="p-4 bg-green-50 rounded-lg border border-green-200">
        <div className="flex items-center gap-2 mb-4">
          <CalendarRange className="w-5 h-5 text-green-600" />
          <h4 className="font-medium text-green-900">Monthly Backup</h4>
        </div>
        <p className="text-sm text-green-700 mb-4">
          Download all party list data for an entire month as CSV file for backup purposes.
        </p>
        <div className="mb-4">
          <label className="block text-sm font-medium text-green-800 mb-2">
            Select Month:
          </label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="w-full px-3 py-2 border border-green-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
          />
          <p className="text-xs text-green-600 mt-2">
            Selected: {selectedMonth ? format(new Date(selectedMonth + '-01'), 'MMMM yyyy') : 'None'}
          </p>
        </div>
        <button
          onClick={handleBackupPartyListMonthly}
          disabled={!selectedMonth}
          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <Package className="w-4 h-4" />
          Backup Monthly Data ({selectedMonth ? format(new Date(selectedMonth + '-01'), 'MMM yyyy') : 'Select Month'})
        </button>
      </div>
    </div>
  );

  const renderDeleteTab = () => (
    <div className="space-y-6">
      <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 mb-6">
        <label className="block text-sm font-medium text-blue-800 mb-2">
          Select Month for Delete Operations:
        </label>
        <input
          type="month"
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="w-full px-3 py-2 border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        <p className="text-xs text-blue-600 mt-2">
          Selected: {selectedMonth ? format(new Date(selectedMonth + '-01'), 'MMMM yyyy') : 'None'}
        </p>
      </div>

      <div className="p-4 bg-red-50 rounded-lg border border-red-200">
        <div className="flex items-center gap-2 mb-4">
          <Trash2 className="w-5 h-5 text-red-600" />
          <h4 className="font-medium text-red-900">Danger Zone</h4>
        </div>
        <p className="text-sm text-red-700 mb-4">
          These actions permanently delete data for the selected month and cannot be undone. Use with extreme caution.
        </p>
        <div className="space-y-3">
          <button
            onClick={() => handleDeleteData('party_list', 'Party List')}
            disabled={!selectedMonth}
            className="w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-left flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Delete Party List ({selectedMonth ? format(new Date(selectedMonth + '-01'), 'MMM yyyy') : 'Select Month'})
          </button>
          <button
            onClick={() => handleDeleteData('label_prints', 'Label Prints')}
            disabled={!selectedMonth}
            className="w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-left flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Delete Label Prints ({selectedMonth ? format(new Date(selectedMonth + '-01'), 'MMM yyyy') : 'Select Month'})
          </button>
          <button
            onClick={() => handleDeleteData('scan_tally', 'Scan Tally')}
            disabled={!selectedMonth}
            className="w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-left flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Delete Scan Tally ({selectedMonth ? format(new Date(selectedMonth + '-01'), 'MMM yyyy') : 'Select Month'})
          </button>
          <button
            onClick={() => handleDeleteData('flagged_parties', 'Flagged Parties')}
            disabled={!selectedMonth}
            className="w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-left flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Delete Flagged Parties ({selectedMonth ? format(new Date(selectedMonth + '-01'), 'MMM yyyy') : 'Select Month'})
          </button>
        </div>
      </div>
    </div>
  );

  const renderNoticeTab = () => {
    if (!canManageDeveloperNotice) {
      return (
        <div className="p-4 bg-red-50 rounded-lg border border-red-200">
          <p className="text-red-700 font-medium">Developer Notice access is restricted.</p>
        </div>
      );
    }

    return (
    <div className="space-y-6">
      <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
        <div className="flex items-center gap-2 mb-3">
          <Bell className="w-5 h-5 text-amber-600" />
          <h4 className="font-medium text-amber-900">Developer Notice</h4>
        </div>
        <p className="text-sm text-amber-800">
          Edit this message from here. When active, users will see it after login without changing the code again.
        </p>
      </div>

      {loadingNotice ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600"></div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Notice Status
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={noticeActive}
                  onChange={(event) => setNoticeActive(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                />
                <span className="text-sm font-medium text-gray-800">
                  Show this notice after login
                </span>
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Title
              </label>
              <input
                type="text"
                value={noticeTitle}
                onChange={(event) => setNoticeTitle(event.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                placeholder="AMC Payment Required"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Message
              </label>
              <textarea
                value={noticeMessage}
                onChange={(event) => setNoticeMessage(event.target.value)}
                rows={5}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                placeholder="Write message for users..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Contact Text
              </label>
              <input
                type="text"
                value={noticeContactText}
                onChange={(event) => setNoticeContactText(event.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                placeholder="Contact RishWin Innovations for renewal."
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Button Text
                </label>
                <input
                  type="text"
                  value={noticeButtonText}
                  onChange={(event) => setNoticeButtonText(event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  placeholder="I Understand"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Shutdown Date
                </label>
                <input
                  type="date"
                  value={noticeShutdownDate}
                  onChange={(event) => setNoticeShutdownDate(event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Style
              </label>
              <select
                value={noticeSeverity}
                onChange={(event) => setNoticeSeverity(event.target.value as 'info' | 'warning' | 'danger')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
              >
                <option value="info">Info - blue</option>
                <option value="warning">Warning - amber</option>
                <option value="danger">Danger - red</option>
              </select>
            </div>

            <button
              type="button"
              onClick={handleSaveNotice}
              className="w-full px-4 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 flex items-center justify-center gap-2"
            >
              <Bell className="w-4 h-4" />
              Save Notice
            </button>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <h4 className="mb-4 text-sm font-medium text-gray-900">Preview</h4>
            <div className="rounded-lg bg-white p-6 shadow">
              <div className="flex items-start gap-3">
                <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
                  noticeSeverity === 'danger'
                    ? 'bg-red-100'
                    : noticeSeverity === 'warning'
                      ? 'bg-amber-100'
                      : 'bg-blue-100'
                }`}>
                  <AlertTriangle className={`h-6 w-6 ${
                    noticeSeverity === 'danger'
                      ? 'text-red-600'
                      : noticeSeverity === 'warning'
                        ? 'text-amber-600'
                        : 'text-blue-600'
                  }`} />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">
                    {noticeTitle || 'Notice title'}
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-gray-700 whitespace-pre-wrap">
                    {noticeMessage || 'Notice message will appear here.'}
                  </p>
                  {noticeShutdownDate && (
                    <p className="mt-3 text-sm font-medium text-red-700">
                      Shutdown date: {format(new Date(noticeShutdownDate), 'dd/MM/yyyy')}
                    </p>
                  )}
                  {noticeContactText && (
                    <p className="mt-3 text-sm font-medium text-gray-900">
                      {noticeContactText}
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${
                    noticeSeverity === 'danger'
                      ? 'bg-red-600'
                      : noticeSeverity === 'warning'
                        ? 'bg-amber-600'
                        : 'bg-blue-600'
                  }`}
                >
                  {noticeButtonText || 'I Understand'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    );
  };

  return (
    <>
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Settings className="w-6 h-6 text-blue-600" />
            Settings
          </h2>
        </div>
        <div className="p-6">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              {!canManageDeveloperNotice && (
                <button
                  onClick={() => setActiveSubTab('users')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    activeSubTab === 'users'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    User Management
                  </div>
                </button>
              )}
              <button
                onClick={() => setActiveSubTab('backup')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeSubTab === 'backup'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Download className="w-4 h-4" />
                  Backup Data
                </div>
              </button>
              {canManageDeveloperNotice && (
                <button
                  onClick={() => setActiveSubTab('delete')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    activeSubTab === 'delete'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Trash2 className="w-4 h-4" />
                    Delete Data
                  </div>
                </button>
              )}
              <button
                onClick={() => setActiveSubTab('company')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeSubTab === 'company'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  Company Details
                </div>
              </button>
              {canManageDeveloperNotice && (
                <button
                  onClick={() => setActiveSubTab('notice')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    activeSubTab === 'notice'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4" />
                    Developer Notice
                  </div>
                </button>
              )}
            </nav>
          </div>

          <div className="mt-6">
            {activeSubTab === 'users' && !canManageDeveloperNotice && renderUsersTab()}
            {activeSubTab === 'backup' && renderBackupTab()}
            {activeSubTab === 'delete' && canManageDeveloperNotice && renderDeleteTab()}
            {activeSubTab === 'notice' && renderNoticeTab()}
            {activeSubTab === 'company' && renderCompanyTab()}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={dialogState.open}
        title={dialogState.title}
        message={dialogState.message}
        confirmText={dialogState.confirmText}
        cancelText={dialogState.cancelText}
        variant={dialogState.variant}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />

      {showDeleteConfirm && deletePayload && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h2 className="text-xl font-bold text-red-700 mb-4">
                Final Confirmation
              </h2>
              <p className="text-gray-700 mb-4">
                This action is permanent and cannot be undone. You are about to delete all <strong>{deletePayload.displayName}</strong> data for <strong>{deletePayload.monthName}</strong>.
              </p>
              <p className="text-gray-700 mb-4">
                To proceed, please type <strong className="text-red-700">DELETE</strong> in the box below.
              </p>
              <input
                type="text"
                value={deleteConfirmInput}
                onChange={(e) => setDeleteConfirmInput(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                placeholder="Type DELETE to confirm"
              />
            </div>
            <div className="flex justify-end p-4 bg-gray-50 border-t rounded-b-lg space-x-3">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteConfirmInput('');
                }}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={executeFinalDelete}
                disabled={deleteConfirmInput !== 'DELETE'}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Permanently Delete Data
              </button>
            </div>
          </div>
        </div>
      )}

      {showChangePasswordModal && selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Key className="w-6 h-6 text-blue-600" />
                <h2 className="text-xl font-bold text-gray-900">
                  Change Password
                </h2>
              </div>
              <p className="text-gray-700 mb-4">
                Changing password for: <strong className="text-blue-600">{selectedUser}</strong>
              </p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    New Password
                  </label>
                  <input
                    type="password"
                    value={modalNewPassword}
                    onChange={(e) => {
                      setModalNewPassword(e.target.value);
                      setModalPasswordError('');
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Enter new password"
                  />
                  {modalPasswordError && (
                    <p className="text-red-600 text-xs mt-1">{modalPasswordError}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    value={modalConfirmPassword}
                    onChange={(e) => {
                      setModalConfirmPassword(e.target.value);
                      setModalConfirmPasswordError('');
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Confirm new password"
                  />
                  {modalConfirmPasswordError && (
                    <p className="text-red-600 text-xs mt-1">{modalConfirmPasswordError}</p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex justify-end p-4 bg-gray-50 border-t rounded-b-lg space-x-3">
              <button
                onClick={() => {
                  setShowChangePasswordModal(false);
                  setSelectedUser(null);
                  setModalNewPassword('');
                  setModalConfirmPassword('');
                  setModalPasswordError('');
                  setModalConfirmPasswordError('');
                }}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleChangePassword}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Change Password
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
