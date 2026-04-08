import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { supabase } from './lib/supabase';
import { syncManager, useRealtimeSync } from './lib/realtimeSync';
import toast from 'react-hot-toast';
import { useAuth } from './hooks/useAuth';
import { useCompanySettings } from './hooks/useCompanySettings';
import { useConfirmDialog } from './hooks/useConfirmDialog';
import { LoginPage } from './components/LoginPage';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { MasterTab } from './components/MasterTab';
import { PartyListTab } from './components/PartyListTab';
import { HistoryTab } from './components/HistoryTab';
import { LabelPrintTab } from './components/LabelPrintTab';
import { ScanTallyTab } from './components/ScanTallyTab';
import { CourierBillTab } from './components/CourierBillTab';
import { PartyLedgerTab } from './components/PartyLedgerTab';
import { FlagPartiesTab } from './components/FlagPartiesTab';
import { CourierRateSettings } from './components/CourierRateSettings';
import { SettingsTab } from './components/SettingsTab';
import {
  Users,
  Plus,
  History,
  Printer,
  Scan,
  Calculator,
  FileText,
  Package,
  X,
  Flag,
  Settings,
  DollarSign,
  Phone,
  LogOut,
  AlertTriangle
} from 'lucide-react';

interface MenuItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  component: React.ComponentType<any>;
}

interface Tab {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  component: React.ComponentType<any>;
}

interface AppNotice {
  id: string;
  title: string;
  message: string;
  contact_text: string | null;
  button_text: string;
  severity: 'info' | 'warning' | 'danger';
  active: boolean;
  shutdown_date: string | null;
}

function ContactUsTab() {
  const phoneNumbers = ['9022766959', '8625083479'];
  const developerEmail = 'galatagerishabh@gmail.com';

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold mb-6 flex items-center justify-center gap-2">
          <Phone className="w-6 h-6 text-blue-600" />
          Contact Us
        </h2>
        <div className="space-y-4 max-w-md mx-auto">
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
            <h3 className="text-lg font-medium text-blue-900 mb-3">Phone Numbers</h3>
            <div className="space-y-2">
              {phoneNumbers.map(phone => (
                <div key={phone} className="flex items-center justify-center gap-2">
                  <Phone className="w-4 h-4 text-blue-600" />
                  <a href={`tel:${phone.replace(/\s/g, '')}`} className="text-blue-600 hover:text-blue-800 font-medium">
                    {phone}
                  </a>
                </div>
              ))}
            </div>
          </div>
          <div className="p-4 bg-green-50 rounded-lg border border-green-200">
            <h3 className="text-lg font-medium text-green-900 mb-3">Email</h3>
            <div className="flex items-center justify-center gap-2">
              <FileText className="w-4 h-4 text-green-600" />
              <a href={`mailto:${developerEmail}`} className="text-green-600 hover:text-green-800 font-medium">
                {developerEmail}
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const menuItems: MenuItem[] = [
  { id: 'master', label: 'Master', icon: Users, component: MasterTab },
  { id: 'party-list', label: 'Party List', icon: Plus, component: PartyListTab },
  { id: 'history', label: 'History', icon: History, component: HistoryTab },
  { id: 'label-print', label: 'Label Print', icon: Printer, component: LabelPrintTab },
  { id: 'scan-tally', label: 'Scan Tally', icon: Scan, component: ScanTallyTab },
  { id: 'courier-bill', label: 'Courier Bill', icon: Calculator, component: CourierBillTab },
  { id: 'party-ledger', label: 'Party Ledger', icon: FileText, component: PartyLedgerTab },
  { id: 'flag-parties', label: 'Flag Parties', icon: Flag, component: FlagPartiesTab },
  { id: 'courier-rates', label: 'Courier Rates', icon: DollarSign, component: CourierRateSettings },
  { id: 'settings', label: 'Settings', icon: Settings, component: SettingsTab },
  { id: 'contact-us', label: 'Contact Us', icon: Phone, component: ContactUsTab },
];

function App() {
  const { isAuthenticated, user, isLoading, login, logout } = useAuth();
  const { settings: co } = useCompanySettings();
  const { dialogState, openConfirmDialog, handleConfirm, handleCancel } = useConfirmDialog();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isFullPageMode, setIsFullPageMode] = useState(false);
  const [totalEntries, setTotalEntries] = useState(0);
  const [appNotice, setAppNotice] = useState<AppNotice | null>(null);
  const [showAppNotice, setShowAppNotice] = useState(false);
  const isDeveloperUser = (user || '').toLowerCase() === 'rish';
  const { settings: companySettings } = useCompanySettings();

  useEffect(() => {
    document.title = companySettings.company_name || 'Parcel Portal';
  }, [companySettings.company_name]);

  // Function to fetch today's total entries count
  const fetchTotalEntriesForToday = async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const { count, error } = await supabase
        .from('party_list')
        .select('*', { count: 'exact', head: true })
        .gte('date', today.toISOString())
        .lt('date', tomorrow.toISOString());

      if (error) {
        console.error('Error fetching total entries:', error);
        return;
      }

      const newTotal = count || 0;
      setTotalEntries(newTotal);
      console.log(`[App Header] Total entries updated: ${newTotal}`);
    } catch (error) {
      console.error('Failed to fetch total entries:', error);
    }
  };

  // Listen to custom sync events from other tabs
  useRealtimeSync(
    ['party_list'],
    async (event) => {
      console.log('[App Header] Sync event received:', event);
      if (event.type === 'create' || event.type === 'update' || event.type === 'delete') {
        await fetchTotalEntriesForToday();
      }
    },
    [],
    'AppHeader'
  );

  // Real-time subscription for total entries count
  useEffect(() => {
    let channel: any = null;

    const setupRealtimeSubscription = async () => {
      try {
        // Fetch initial count
        await fetchTotalEntriesForToday();

        // Set up real-time subscription
        channel = supabase
          .channel('party_list_app_header')
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'party_list'
            },
            async (payload) => {
              console.log('[App Header] INSERT detected in party_list:', payload);
              await fetchTotalEntriesForToday();
            }
          )
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'party_list'
            },
            async (payload) => {
              console.log('[App Header] UPDATE detected in party_list:', payload);
              await fetchTotalEntriesForToday();
            }
          )
          .on(
            'postgres_changes',
            {
              event: 'DELETE',
              schema: 'public',
              table: 'party_list'
            },
            async (payload) => {
              console.log('[App Header] DELETE detected in party_list:', payload);
              await fetchTotalEntriesForToday();
            }
          )
          .subscribe((status) => {
            console.log('[App Header] Subscription status:', status);
          });

        console.log('Real-time subscription established for total entries');
      } catch (error) {
        console.error('Failed to setup real-time subscription:', error);
      }
    };

    if (isAuthenticated) {
      setupRealtimeSubscription();
    }

    // Cleanup function
    return () => {
      if (channel) {
        supabase.removeChannel(channel);
        console.log('Real-time subscription cleaned up');
      }
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      const interval = setInterval(() => {
        const stats = syncManager.getStats();
        if (stats.activeListeners > 0 || stats.queuedEvents > 0) {
          console.log('Sync Stats:', stats);
        }
      }, 10000);
      return () => clearInterval(interval);
    }
  }, []);

  useEffect(() => {
    const fetchAppNotice = async () => {
      if (!isAuthenticated || isDeveloperUser) {
        setAppNotice(null);
        setShowAppNotice(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('app_notices')
          .select('*')
          .eq('active', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          if (error.code !== '42P01' && error.code !== 'PGRST205') {
            console.error('Failed to fetch app notice:', error);
          }
          return;
        }

        if (data) {
          setAppNotice(data as AppNotice);
          setShowAppNotice(true);
        }
      } catch (error) {
        console.error('Failed to fetch app notice:', error);
      }
    };

    fetchAppNotice();
  }, [isAuthenticated, isDeveloperUser]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // ESC to exit full page mode
      if (event.key === 'Escape' && isFullPageMode) {
        setIsFullPageMode(false);
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        return;
      }

      // Check if an input field is focused
      const target = event.target as HTMLElement;
      const isInputFocused =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      // Skip tab switching if input is focused
      if (isInputFocused) {
        return;
      }

      // Ctrl+Tab: Switch to next tab
      if (event.ctrlKey && event.key === 'Tab' && !event.shiftKey && tabs.length > 0) {
        event.preventDefault();
        const currentIndex = tabs.findIndex(tab => tab.id === activeTabId);
        const nextIndex = (currentIndex + 1) % tabs.length;
        setActiveTabId(tabs[nextIndex].id);
        setIsFullPageMode(true);
        return;
      }

      // Ctrl+Shift+Tab: Switch to previous tab
      if (event.ctrlKey && event.shiftKey && event.key === 'Tab' && tabs.length > 0) {
        event.preventDefault();
        const currentIndex = tabs.findIndex(tab => tab.id === activeTabId);
        const prevIndex = currentIndex <= 0 ? tabs.length - 1 : currentIndex - 1;
        setActiveTabId(tabs[prevIndex].id);
        setIsFullPageMode(true);
        return;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFullPageMode, tabs, activeTabId]);

  const handleMenuClick = (menuItem: MenuItem) => {
    const existingTab = tabs.find(tab => tab.id === menuItem.id);
    if (existingTab) {
      setActiveTabId(menuItem.id);
      setIsFullPageMode(true);
    } else {
      const newTab: Tab = {
        id: menuItem.id,
        label: menuItem.label,
        icon: menuItem.icon,
        component: menuItem.component
      };
      setTabs(prevTabs => [...prevTabs, newTab]);
      setActiveTabId(menuItem.id);
      setIsFullPageMode(true);
    }
  };

  const handleTabClick = (tabId: string) => {
    setActiveTabId(tabId);
    setIsFullPageMode(true);
  };

  const handleTabClose = (tabId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setTabs(prevTabs => prevTabs.filter(tab => tab.id !== tabId));
    if (activeTabId === tabId) {
      const remainingTabs = tabs.filter(tab => tab.id !== tabId);
      if (remainingTabs.length > 0) {
        setActiveTabId(remainingTabs[remainingTabs.length - 1].id);
        setIsFullPageMode(true);
      } else {
        setActiveTabId(null);
        setIsFullPageMode(false);
      }
    }
  };

  const activeTab = tabs.find(tab => tab.id === activeTabId);

  const handleLogout = async () => {
    const confirmed = await openConfirmDialog({
      title: 'Logout Confirmation',
      message: 'Are you sure you want to logout?',
      confirmText: 'Logout',
      cancelText: 'Stay Logged In',
      variant: 'primary'
    });
    if (confirmed) {
      logout();
      toast.success('Logged out successfully');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={login} />;
  }

  return (
    <div className="min-h-screen flex bg-gray-50">
      {!isFullPageMode && (
        <div className="w-1/2 bg-white shadow-lg border-r border-gray-200 flex flex-col">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <Package className="w-8 h-8 text-blue-600" />
              <div>
                <h1 className="text-lg font-bold text-gray-900 leading-tight">
                  {companySettings.company_name}
                </h1>
                <p className="text-sm text-gray-600">Parcel Portal</p>
                {user && (
                  <p className="text-xs text-blue-600 font-medium">Welcome, {user}</p>
                )}
                <p className="text-xs text-green-600 font-medium">
                  Today's entries: {totalEntries}
                </p>
              </div>
            </div>
          </div>
          <nav className="flex-1 p-4">
            <ul className="space-y-2">
              {menuItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTabId === item.id;
                return (
                  <li key={item.id}>
                    <button
                      onClick={() => handleMenuClick(item)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                        isActive
                          ? 'bg-blue-100 text-blue-700 border border-blue-200'
                          : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                      }`}
                    >
                      <Icon className={`w-5 h-5 ${isActive ? 'text-blue-600' : 'text-gray-500'}`} />
                      <span className="font-medium">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-6 pt-4 border-t border-gray-200">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors text-gray-700 hover:bg-gray-100 hover:text-gray-900 mt-2"
              >
                <LogOut className="w-5 h-5 text-gray-500" />
                <span className="font-medium">Logout</span>
              </button>
            </div>
          </nav>
          <div className="p-4 border-t border-gray-200">
            <p className="text-xs text-gray-500 text-center">
              © 2025 RishWin Innovations
            </p>
          </div>
        </div>
      )}
      <div className={`flex flex-col ${isFullPageMode ? 'w-full' : 'w-1/2'}`}>
        {tabs.length > 0 && (
          <div className="bg-white border-b border-gray-200 px-4 py-2">
            <div className="flex space-x-1 overflow-x-auto">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTabId === tab.id;
                return (
                  <div
                    key={tab.id}
                    onClick={() => handleTabClick(tab.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-t-lg cursor-pointer whitespace-nowrap transition-colors ${
                      isActive
                        ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-sm font-medium">{tab.label}</span>
                    <button
                      onClick={(e) => handleTabClose(tab.id, e)}
                      className="ml-1 p-1 rounded hover:bg-gray-200 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex-1 overflow-auto">
          {isFullPageMode && activeTab ? (
            <div className="h-full">
              <div className="p-6">
                <activeTab.component currentUser={user || ''} />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center max-w-md">
                <Package className="w-16 h-16 text-gray-300 mx-auto mb-6" />
                <h2 className="text-2xl font-bold text-gray-900 mb-4">
                  Welcome to {companySettings.company_name}
                </h2>
                <p className="text-gray-600 mb-6">
                  Select a module from the navigation menu to get started with parcel management.
                </p>
                <div className="text-sm text-gray-500 space-y-2">
                  <p>• Click any menu item to open a new tab</p>
                  <p>• Multiple tabs can be open simultaneously</p>
                  <p>• Press <kbd className="px-2 py-1 bg-gray-200 rounded text-xs">ESC</kbd> to return to navigation</p>
                  <p>• Press <kbd className="px-2 py-1 bg-gray-200 rounded text-xs">Ctrl+Tab</kbd> to switch to next tab</p>
                  <p>• Press <kbd className="px-2 py-1 bg-gray-200 rounded text-xs">Ctrl+Shift+Tab</kbd> to switch to previous tab</p>
                  <p>• Use the × button to close individual tabs</p>
                </div>
              </div>
            </div>
          )}
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
      {showAppNotice && appNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="flex items-start gap-3">
              <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
                appNotice.severity === 'danger'
                  ? 'bg-red-100'
                  : appNotice.severity === 'warning'
                    ? 'bg-amber-100'
                    : 'bg-blue-100'
              }`}>
                <AlertTriangle className={`h-6 w-6 ${
                  appNotice.severity === 'danger'
                    ? 'text-red-600'
                    : appNotice.severity === 'warning'
                      ? 'text-amber-600'
                      : 'text-blue-600'
                }`} />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {appNotice.title}
                </h2>
                <p className="mt-3 text-sm leading-6 text-gray-700">
                  {appNotice.message}
                </p>
                {appNotice.shutdown_date && (
                  <p className="mt-3 text-sm font-medium text-red-700">
                    Shutdown date: {format(new Date(appNotice.shutdown_date), 'dd/MM/yyyy')}
                  </p>
                )}
                {appNotice.contact_text && (
                  <p className="mt-3 text-sm font-medium text-gray-900">
                    {appNotice.contact_text}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setShowAppNotice(false)}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors ${
                  appNotice.severity === 'danger'
                    ? 'bg-red-600 hover:bg-red-700'
                    : appNotice.severity === 'warning'
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {appNotice.button_text || 'I Understand'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
