import React, { useState, useEffect, useRef } from 'react';
import { useAutoPageSize } from '../hooks/useAutoPageSize';
import { supabase, handleSupabaseError, testSupabaseConnection } from '../lib/supabase';
import { useRealtimeSync, emitSyncEvent, performanceMonitor } from '../lib/realtimeSync';
// *** START OF FIX 1 ***
// The old, buggy generateQRCode function is no longer imported.
import { createLabelPrintRecord, updateLabelPrintRecord } from '../lib/labelPersistence';
// *** END OF FIX 1 ***
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { Download, Printer, Package, Plus, Phone, ClipboardList, FileText } from 'lucide-react';
import { useCompanySettings } from '../hooks/useCompanySettings';
import { format } from 'date-fns';
import { formatTime, formatDate } from '../lib/dateUtils';
import toast from 'react-hot-toast';

interface PartyInfo {
  party_code: string;
  party_name: string;
  address: string;
  phone_number?: string;
}

interface CourierAgency {
  id: string;
  agency_name: string;
  agency_number: string;
}

interface PartyList {
  id: string;
  date: string;
  party_code: string;
  bill_numbers: string[];
  courier_agency_id: string;
  boxes: number;
  party_info?: PartyInfo;
  courier_agency?: CourierAgency;
  serialNumber?: number;
  created_at: string;
}

interface CourierSummary {
  agency_name: string;
  total_boxes: number;
  total_bills: number;
  total_orders: number;
}

export function PartyListTab() {
  const { settings: co } = useCompanySettings();
  const { dialogState, openConfirmDialog, handleConfirm, handleCancel } = useConfirmDialog();
  
  // Form state
  const [partyCode, setPartyCode] = useState('');
  const [partyInfo, setPartyInfo] = useState<PartyInfo | null>(null);
  const [billNumbers, setBillNumbers] = useState('');
  const [selectedCourier, setSelectedCourier] = useState('');
  const [boxes, setBoxes] = useState<number>(1);
  
  // Data state
  const [courierAgencies, setCourierAgencies] = useState<CourierAgency[]>([]);
  const [todayEntries, setTodayEntries] = useState<PartyList[]>([]);
  const [existingParty, setExistingParty] = useState<PartyList | null>(null);
  const [courierSummary, setCourierSummary] = useState<CourierSummary[]>([]);
  
  // UI state
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const [totalEntries, setTotalEntries] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [showCourierSummary, setShowCourierSummary] = useState(false);
  const [summaryFilter, setSummaryFilter] = useState<'all' | 'courier' | 'byhand'>('all');
  
  // Typing and validation state
  const [isTyping, setIsTyping] = useState(false);
  const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timeout | null>(null);
  const [existingBillNumbers, setExistingBillNumbers] = useState<string[]>([]);
  const [billValidationTimeout, setBillValidationTimeout] = useState<NodeJS.Timeout | null>(null);
  const [lastSubmitTime, setLastSubmitTime] = useState<number>(0);
  
  // Dropdown navigation state
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [highlightedOption, setHighlightedOption] = useState(-1);
  
  const itemsPerPage = useAutoPageSize(44, 400); // auto-fit rows to viewport

  // Refs for keyboard navigation
  const partyCodeInputRef = useRef<HTMLInputElement>(null);
  const billNumbersInputRef = useRef<HTMLInputElement>(null);
  const courierSelectRef = useRef<HTMLSelectElement>(null);
  const boxesInputRef = useRef<HTMLInputElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);

  // Real-time sync setup
  useRealtimeSync(
    ['party_list'],
    async (event) => {
      if (event.source !== 'party-list') {
        console.log('Real-time sync triggered in PartyListTab:', event);
        await fetchTodayEntries();
        await refreshTotalEntriesCount();
      }
    },
    []
  );

  // Supabase Realtime subscription for cross-client sync
  useEffect(() => {
    const channel = supabase
      .channel('party_list_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'party_list'
        },
        (payload) => {
          console.log('Supabase Realtime: party_list changed', payload);
          fetchTodayEntries();
          refreshTotalEntriesCount();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bill_numbers_registry'
        },
        (payload) => {
          console.log('Supabase Realtime: bill_numbers_registry changed', payload);
          fetchTodayEntries();
          refreshTotalEntriesCount();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Initialize data on component mount
  useEffect(() => {
    const loadData = async () => {
      try {
        setNetworkError(false);

        // Test connection first
        const isConnected = await testSupabaseConnection();
        if (!isConnected) {
          throw new Error('Unable to connect to the database. Please check your internet connection.');
        }

        await Promise.all([
          fetchCourierAgencies(),
          fetchTodayEntries()
        ]);
      } catch (error) {
        console.error('Failed to load initial data:', error);
        const errorMessage = handleSupabaseError(error);
        toast.error(errorMessage);

        // Set network error for connection issues
        if (error instanceof Error && (
          error.message?.includes('fetch') ||
          error.message?.includes('connect') ||
          error.message?.includes('network') ||
          error.name === 'TypeError'
        )) {
          setNetworkError(true);
        }
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // Update dropdown options when dropdown opens
  useEffect(() => {
    if (courierSelectRef.current && isDropdownOpen) {
      if (courierAgencies.length > 0 && highlightedOption === -1) {
        setHighlightedOption(0);
      }
    }
  }, [isDropdownOpen, courierAgencies.length]);

  // Helper function to check if courier name is Solakanure/Solankure (case-insensitive)
  const isSolakanureEntry = (courierName: string) => {
    const normalizedName = courierName.toLowerCase();
    return normalizedName.includes('solakanure') || normalizedName.includes('solankure');
  };

  // Helper function to check if courier is "By-Hand"
  const isByHandEntry = (courierName: string) => {
    const normalizedName = courierName.toLowerCase();
    return normalizedName.includes('by-hand') || normalizedName.includes('by hand') || normalizedName.includes('byhand');
  };

  const getSolakanureSerialNumber = (entries: PartyList[], targetEntryId: string) => {
    // Find the target entry's position
    const targetIndex = entries.findIndex(entry => entry.id === targetEntryId);

    if (targetIndex === -1) return 0;

    // Count Solakanure entries up to and including the target entry
    let solakanureCount = 0;
    for (let i = 0; i <= targetIndex; i++) {
      if (isSolakanureEntry(entries[i].courier_agency?.agency_name || '')) {
        solakanureCount++;
      }
    }

    return solakanureCount;
  };

  const calculateCourierSummary = (entries: PartyList[]) => {
    const summary = entries.reduce((acc, entry) => {
      const agencyName = entry.courier_agency?.agency_name || 'Unknown';
      
      if (!acc[agencyName]) {
        acc[agencyName] = {
          agency_name: agencyName,
          total_boxes: 0,
          total_bills: 0,
          total_orders: 0
        };
      }
      
      acc[agencyName].total_boxes += entry.boxes;
      acc[agencyName].total_bills += entry.bill_numbers.length;
      acc[agencyName].total_orders += 1;
      
      return acc;
    }, {} as Record<string, CourierSummary>);

    return Object.values(summary).sort((a, b) => b.total_bills - a.total_bills);
  };

  const getFilteredCourierSummary = () => {
    if (summaryFilter === 'all') {
      return courierSummary;
    } else if (summaryFilter === 'courier') {
      return courierSummary.filter(summary => !isByHandEntry(summary.agency_name));
    } else if (summaryFilter === 'byhand') {
      return courierSummary.filter(summary => isByHandEntry(summary.agency_name));
    }
    return courierSummary;
  };

  // Reset form to initial state
  const resetForm = () => {
    setPartyCode('');
    setPartyInfo(null);
    setBillNumbers('');
    setSelectedCourier('');
    setBoxes(1);
    setExistingParty(null);
    setExistingBillNumbers([]);

    // Focus on party code input
    if (partyCodeInputRef.current) {
      partyCodeInputRef.current.focus();
    }
  };

  // Keyboard navigation handlers
  const handlePartyCodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && billNumbersInputRef.current && partyInfo) {
      e.preventDefault();
      billNumbersInputRef.current.focus();
    }
  };

  const handleBillNumbersKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && courierSelectRef.current && !existingParty) {
      e.preventDefault();
      courierSelectRef.current.focus();
    }
  };

  const handleCourierKeyDown = (e: React.KeyboardEvent<HTMLSelectElement>) => {
    if (existingParty) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (courierAgencies.length > 0) {
          const nextIndex = (highlightedOption + 1) % courierAgencies.length;
          setHighlightedOption(nextIndex);
          setSelectedCourier(courierAgencies[nextIndex].id);
          if (courierSelectRef.current) {
            courierSelectRef.current.selectedIndex = nextIndex + 1; // +1 for placeholder
          }
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (courierAgencies.length > 0) {
          const nextIndex = highlightedOption <= 0 
            ? courierAgencies.length - 1 
            : highlightedOption - 1;
          setHighlightedOption(nextIndex);
          setSelectedCourier(courierAgencies[nextIndex].id);
          if (courierSelectRef.current) {
            courierSelectRef.current.selectedIndex = nextIndex + 1; // +1 for placeholder
          }
        }
        break;

      case 'Enter':
        e.preventDefault();
        if (boxesInputRef.current) {
          boxesInputRef.current.focus();
        }
        break;

      case 'Tab':
        if (boxesInputRef.current) {
          boxesInputRef.current.focus();
        }
        break;
    }
  };

  const handleBoxesKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && submitButtonRef.current) {
      e.preventDefault();
      submitButtonRef.current.click();
    }
  };

  const handleBoxesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const numValue = value === '' ? 1 : parseInt(value) || 1;

    if (numValue > 150) {
      toast.error('Box count cannot be more than 150');
      setBoxes(150);
      return;
    }

    setBoxes(Math.max(1, Math.min(150, numValue)));
  };

  // *** START OF FIX 2 ***
  // Helper to get the current financial year start date (April 1st)
  const getFinancialYearStart = (): Date => {
    const today = new Date();
    const month = today.getMonth(); // 0-indexed, so March = 2, April = 3
    const year = today.getFullYear();
    // If current month is April (3) or later, FY started this year; otherwise last year
    const fyYear = month >= 3 ? year : year - 1;
    return new Date(fyYear, 3, 1); // April 1st
  };
  // *** END OF FIX 2 ***

  const handleBillNumbersChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setBillNumbers(value);

    if (billValidationTimeout) {
      clearTimeout(billValidationTimeout);
    }

    const timeout = setTimeout(() => {
      const currentBills = value.split(',').map(num => num.trim()).filter(Boolean);

      // *** START OF FIX 3 ***
      // Only warn about duplicates within the current financial year's today entries
      // (todayEntries already only contains today's data, so this is inherently scoped correctly.
      // The key fix was in the DB trigger — this client-side check just mirrors that scope.)
      const financialYearStart = getFinancialYearStart();
      const duplicates = currentBills.filter(bill =>
        todayEntries?.some(entry => {
          const entryDate = new Date(entry.date);
          return entry.bill_numbers?.includes(bill) && entryDate >= financialYearStart;
        })
      );
      // *** END OF FIX 3 ***

      if (duplicates.length > 0) {
        toast.error(`Warning: Bill number(s) ${duplicates.join(', ')} already exist in today's entries`, {
          duration: 5000,
        });
        setExistingBillNumbers(duplicates);
      } else {
        setExistingBillNumbers([]);
      }
    }, 500);

    setBillValidationTimeout(timeout);
  };

  const handleCourierChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedIndex = e.target.selectedIndex - 1; // -1 for placeholder
    setHighlightedOption(selectedIndex);
    setSelectedCourier(e.target.value);
    if (e.target.value && boxesInputRef.current) {
      boxesInputRef.current.focus();
    }
  };

  const handleCourierFocus = () => {
    setIsDropdownOpen(true);
  };

  const handleCourierBlur = () => {
    setTimeout(() => {
      setIsDropdownOpen(false);
    }, 200);
  };

  async function fetchCourierAgencies() {
    try {
      const { data, error } = await supabase
        .from('courier_agency_list')
        .select('*')
        .order('agency_name');
      
      if (error) throw error;
      setCourierAgencies(data || []);
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(errorMessage);
      throw error;
    }
  }

  async function refreshTotalEntriesCount() {
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

      if (error) throw error;
      setTotalEntries(count || 0);
    } catch (error) {
      console.error('Error refreshing total entries count:', error);
    }
  }

  async function fetchTodayEntries() {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const { data, error } = await supabase
        .from('party_list')
        .select(`
          *,
          party_info:party_information(*),
          courier_agency:courier_agency_list(*)
        `)
        .gte('date', today.toISOString())
        .lt('date', tomorrow.toISOString())
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Assign sequential serial numbers based on creation order
      const processedData = data?.map((entry, index) => ({
        ...entry,
        serialNumber: index + 1
      })) || [];

      setTodayEntries(processedData);
      setTotalEntries(processedData.length);
      setCourierSummary(calculateCourierSummary(processedData));
    } catch (error) {
      console.error('Error fetching today entries:', error);
      throw error;
    }
  }

  const handlePartyCodeChange = async (code: string) => {
    setPartyCode(code);
    setPartyInfo(null);
    setExistingParty(null);
    
    // Reset courier selection when party code is cleared
    if (!code.trim()) {
      setSelectedCourier('');
      setIsTyping(false);
      return;
    }
    
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }

    setIsTyping(true);

    const timeout = setTimeout(async () => {
      setIsTyping(false);

      try {
        const existingEntry = todayEntries?.find(entry => entry.party_code === code);
        if (existingEntry) {
          setExistingParty(existingEntry);
          setPartyInfo(existingEntry.party_info || null);
          // Set the courier from the existing entry
          setSelectedCourier(existingEntry.courier_agency_id);
          toast.error(`Serial #${existingEntry.serialNumber} - Party already exists in today's entries`, {
            duration: 5000,
            style: {
              background: '#FEE2E2',
              color: '#991B1B',
              border: '1px solid #F87171'
            }
          });
          return;
        }

        const { data, error } = await supabase
          .from('party_information')
          .select('*')
          .eq('party_code', code)
          .maybeSingle();

        if (error && error.code !== 'PGRST116') throw error;
        
        if (!data) {
          toast.error('Party not found');
          // Reset courier selection when party is not found
          setSelectedCourier('');
          return;
        }
        
        setPartyInfo(data);
        // Reset courier selection for new party
        setSelectedCourier('');
      } catch (error) {
        const errorMessage = handleSupabaseError(error);
        toast.error(errorMessage);
        // Reset courier selection on error
        setSelectedCourier('');
      }
    }, 1000);

    setTypingTimeout(timeout);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!partyInfo) {
      toast.error('Please select a valid party');
      return;
    }

    if (submitting) {
      return;
    }

    const now = Date.now();
    if (now - lastSubmitTime < 1000) {
      toast.error('Please wait a moment before submitting again');
      return;
    }
    setLastSubmitTime(now);

    setSubmitting(true);

    try {
      const billNumbersArray = billNumbers.split(',').map(num => num.trim()).filter(Boolean);

      if (billNumbersArray.length === 0) {
        toast.error('Please enter at least one bill number');
        setSubmitting(false);
        return;
      }

      // Use atomic database function to handle concurrent users
      // This function ensures no duplicates can be created even if multiple users
      // submit at the exact same time
      toast.loading('Processing entry...', { id: 'atomic-operation' });

      const { data: atomicResult, error: atomicError } = await supabase
        .rpc('atomic_add_bills_to_party', {
          p_party_code: partyCode,
          p_new_bills: billNumbersArray,
          p_additional_boxes: existingParty ? 0 : boxes,
          p_courier_agency_id: selectedCourier,
          p_date: new Date().toISOString()
        });

      if (atomicError) {
        // Check if it's a duplicate bill error
        if (atomicError.message?.includes('Bill number(s) already exist')) {
          const match = atomicError.message?.match(/Bill number\(s\) already exist: ([^.]+)/);
          const duplicateBills = match ? match[1] : 'some bill numbers';
          // *** START OF FIX 4 ***
          toast.error(`❌ Duplicate Bills: ${duplicateBills} already exist in current financial year. Please check your entry.`, {
          // *** END OF FIX 4 ***
            id: 'atomic-operation',
            duration: 8000,
            style: {
              background: '#DC2626',
              color: '#fff',
              fontWeight: 'bold',
              fontSize: '16px',
              padding: '16px'
            }
          });
          setSubmitting(false);
          return;
        }
        throw atomicError;
      }

      if (!atomicResult || atomicResult.length === 0) {
        toast.error('Failed to process entry', { id: 'atomic-operation' });
        setSubmitting(false);
        return;
      }

      const result = atomicResult[0];
      const wasCreated = result.was_created;
      const entryId = result.id;
      const totalBoxes = result.boxes;
      const totalBills = result.merged_bills_count;

      // Handle label_prints for BOTH new entries AND merged entries
      try {
        const entryWithInfo = {
          id: entryId,
          party_code: partyCode,
          bill_numbers: result.bill_numbers,
          boxes: result.boxes,
          courier_agency_id: result.courier_agency_id,
          date: result.date,
          party_info: partyInfo,
          courier_agency: courierAgencies.find(agency => agency.id === selectedCourier) ?? { id: '', agency_name: '', agency_number: '' },
          serialNumber: (todayEntries?.length || 0) + 1
        };

        if (wasCreated) {
          // New entry - create label
          await createLabelPrintRecord(entryWithInfo);
        } else {
          // Merged entry - update existing label with new bill numbers and boxes
          await updateLabelPrintRecord(entryWithInfo);
        }
      } catch (labelError) {
        console.error('Failed to handle label print record:', labelError);
      }

      // Sync and refresh data BEFORE showing notification
      emitSyncEvent(wasCreated ? 'create' : 'update', 'party_list', entryId, { partyCode });
      await fetchTodayEntries();

      // Show success message with accurate serial number
      const selectedCourierAgency = courierAgencies.find(agency => agency.id === selectedCourier);
      const courierName = selectedCourierAgency?.agency_name || '';

      if (isSolakanureEntry(courierName)) {
        let solakanureSerialNumber = 0;

        if (wasCreated) {
          // For new entries, count all existing Solakanure entries and add 1
          solakanureSerialNumber = todayEntries.filter(entry =>
            isSolakanureEntry(entry.courier_agency?.agency_name || '')
          ).length + 1;
        } else {
          // For existing entries, use the existing logic
          solakanureSerialNumber = getSolakanureSerialNumber(todayEntries, entryId);
        }

        toast.success(
          `Solakanure ${wasCreated ? 'entry created' : 'bills merged'}! Serial No: ${solakanureSerialNumber}`,
          {
            id: 'atomic-operation',
            duration: 10000,
            style: {
              background: '#059669',
              color: '#fff',
              fontWeight: 'bold',
              fontSize: '16px',
              padding: '16px'
            }
          }
        );
      } else {
        toast.success(
          `${wasCreated ? 'Entry created' : 'Bills merged'} successfully`,
          { id: 'atomic-operation' }
        );
      }
      await refreshTotalEntriesCount();
      resetForm();
      setSubmitting(false);
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(errorMessage);
      setSubmitting(false);
    }
  }

  function handleDownload() {
    const csv = [
      ['Time', 'Party Code', 'Party Name', 'Bill Numbers', 'Courier Agency', 'Boxes'],
      ...todayEntries.map(entry => [
        formatTime(new Date(entry.date)),
        entry.party_code,
        entry.party_info?.party_name,
        entry.bill_numbers.join('; '),
        entry.courier_agency?.agency_name,
        entry.boxes
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `party_list_${formatDate(new Date())}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  function handlePrint() {
    window.print();
  }

  // Pagination logic
  const getCurrentEntries = () => {
    const startIndex = currentPage * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return todayEntries.slice(startIndex, endIndex);
  };

  const totalPages = Math.ceil(todayEntries.length / itemsPerPage);

  const getDisplayInfo = () => {
    const currentEntries = getCurrentEntries();
    const startIndex = currentPage * itemsPerPage;
    
    return {
      start: currentEntries.length > 0 ? startIndex + 1 : 0,
      end: startIndex + currentEntries.length,
      total: todayEntries.length
    };
  };

  const displayInfo = getDisplayInfo();
  const currentDate = new Date();

  // Network error state
  if (networkError) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="text-center py-12">
          <h3 className="text-base font-semibold text-gray-900 mb-1">Connection Error</h3>
          <p className="text-sm text-gray-500 mb-4">Unable to connect to the server. Please check your internet connection.</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Party List Entry</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            <span className="font-semibold text-blue-600">{totalEntries}</span> entries today
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right pr-3 border-r border-gray-200">
            <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              {format(currentDate, 'EEEE')}
            </div>
            <div className="text-sm font-bold text-gray-700">
              {formatDate(currentDate)}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowCourierSummary(!showCourierSummary)}
              title={showCourierSummary ? 'Hide Summary' : 'Show Summary'}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                showCourierSummary
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <Package className="w-4 h-4" />
              <span>{showCourierSummary ? 'Hide Summary' : 'Show Summary'}</span>
            </button>
            <button
              onClick={handleDownload}
              title="Download CSV"
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={handlePrint}
              title="Print"
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors"
            >
              <Printer className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Courier Summary */}
      {showCourierSummary && courierSummary.length > 0 && (
        <div className="border-b border-gray-100 px-6 py-4 bg-slate-50 no-print">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
              <Package className="w-4 h-4 text-blue-500" />
              Courier Services Summary
            </h3>
            <div className="flex gap-1">
              {(['all', 'courier', 'byhand'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setSummaryFilter(f)}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                    summaryFilter === f
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {f === 'all' ? 'All' : f === 'courier' ? 'Courier' : 'By-Hand'}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {getFilteredCourierSummary().map((summary) => (
              <div
                key={summary.agency_name}
                className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm"
              >
                <p className="text-sm font-bold text-gray-900 leading-tight mb-2">{summary.agency_name}</p>
                <div className="grid grid-cols-3 gap-1 text-center">
                  <div>
                    <ClipboardList className="w-4 h-4 mx-auto mb-1 text-blue-500" />
                    <div className="text-sm font-bold text-blue-700">{summary.total_orders}</div>
                    <div className="text-xs text-gray-600">Orders</div>
                  </div>
                  <div>
                    <FileText className="w-4 h-4 mx-auto mb-1 text-green-500" />
                    <div className="text-sm font-bold text-green-700">{summary.total_bills}</div>
                    <div className="text-xs text-gray-600">Bills</div>
                  </div>
                  <div>
                    <Package className="w-4 h-4 mx-auto mb-1 text-purple-500" />
                    <div className="text-sm font-bold text-purple-700">{summary.total_boxes}</div>
                    <div className="text-xs text-gray-600">Boxes</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {getFilteredCourierSummary().length === 0 && (
            <p className="text-sm text-center text-gray-400 py-3">
              No {summaryFilter === 'byhand' ? 'by-hand' : 'courier'} entries found
            </p>
          )}
        </div>
      )}

      {/* Entry Form */}
      <form onSubmit={handleSubmit} className="px-6 py-5 border-b border-gray-100 space-y-4">
        {/* Party Info Row */}
        <div className="grid grid-cols-12 gap-3">
          {/* Party Code */}
          <div className="col-span-12 sm:col-span-3">
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1.5">
              Party Code
            </label>
            <input
              ref={partyCodeInputRef}
              type="text"
              required
              value={partyCode}
              onChange={(e) => handlePartyCodeChange(e.target.value)}
              onKeyDown={handlePartyCodeKeyDown}
              className={`w-full h-10 px-3 text-sm bg-gray-50 text-gray-900 placeholder-gray-400 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all ${
                existingParty ? 'border-red-400 bg-red-50' : 'border-gray-300'
              }`}
              placeholder="Enter party code"
            />
            {isTyping && (
              <p className="mt-1 text-xs text-gray-400">Searching...</p>
            )}
          </div>

          {/* Party Name */}
          <div className="col-span-12 sm:col-span-4">
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1.5">
              Party Name
            </label>
            <input
              type="text"
              value={partyInfo?.party_name || ''}
              readOnly
              className={`w-full h-10 px-3 text-sm bg-gray-50 text-gray-900 border rounded-lg cursor-default ${
                existingParty ? 'border-red-400 bg-red-50' : 'border-gray-300'
              }`}
              placeholder={partyCode ? (isTyping ? 'Searching...' : 'Party not found') : 'Enter party code first'}
            />
          </div>

          {/* Party Address */}
          <div className="col-span-12 sm:col-span-5">
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1.5">
              Address & Phone
            </label>
            <div
              className={`w-full px-3 py-2 text-sm bg-gray-50 text-gray-900 border rounded-lg min-h-[40px] ${
                existingParty ? 'border-red-400 bg-red-50' : 'border-gray-300'
              }`}
            >
              <div className="text-gray-700">{partyInfo?.address || <span className="text-gray-400">No address available</span>}</div>
              {partyInfo?.phone_number && (
                <div className="flex items-center gap-1 text-gray-500 text-xs mt-0.5">
                  <Phone className="w-3 h-3" />
                  {partyInfo.phone_number}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Dispatch Info Row */}
        <div className="grid grid-cols-12 gap-3 items-end">
          <div className="col-span-12 sm:col-span-5">
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1.5">
              Bill Numbers <span className="normal-case font-normal text-gray-400">(comma separated)</span>
            </label>
            <input
              ref={billNumbersInputRef}
              type="text"
              required
              value={billNumbers}
              onChange={handleBillNumbersChange}
              onKeyDown={handleBillNumbersKeyDown}
              className={`w-full h-10 px-3 text-sm bg-gray-50 text-gray-900 placeholder-gray-400 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all ${
                existingBillNumbers.length > 0 ? 'border-yellow-400 bg-yellow-50' : 'border-gray-300'
              }`}
              placeholder="e.g. 45547, 45548"
            />
            {existingBillNumbers.length > 0 && (
              <p className="mt-1 text-xs text-yellow-600 font-medium">Warning: some bill numbers already exist</p>
            )}
          </div>

          <div className="col-span-12 sm:col-span-4">
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1.5">
              Courier Service
            </label>
            {existingParty ? (
              <div className="w-full h-10 px-3 text-sm bg-gray-100 text-gray-700 border border-gray-300 rounded-lg flex items-center">
                {existingParty.courier_agency?.agency_name || 'Unknown Courier'}
              </div>
            ) : (
              <select
                ref={courierSelectRef}
                required
                value={selectedCourier}
                onChange={handleCourierChange}
                onKeyDown={handleCourierKeyDown}
                onFocus={handleCourierFocus}
                onBlur={handleCourierBlur}
                className="w-full h-10 px-3 text-sm bg-gray-50 text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              >
                <option value="">Select Courier</option>
                {courierAgencies.map((agency) => (
                  <option key={agency.id} value={agency.id}>
                    {agency.agency_name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="col-span-6 sm:col-span-2">
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1.5">
              Boxes
            </label>
            {existingParty ? (
              <div className="w-full h-10 px-3 text-sm bg-gray-100 text-gray-700 border border-gray-300 rounded-lg flex items-center font-semibold">
                {existingParty.boxes}
              </div>
            ) : (
              <input
                ref={boxesInputRef}
                type="number"
                required
                min="1"
                max="150"
                value={boxes}
                onChange={handleBoxesChange}
                onKeyDown={handleBoxesKeyDown}
                className="w-full h-10 px-3 text-sm bg-gray-50 text-gray-900 font-semibold border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
            )}
          </div>

          <div className="col-span-6 sm:col-span-1 flex justify-end sm:justify-start">
            <button
              ref={submitButtonRef}
              type="submit"
              disabled={submitting || !partyInfo || !selectedCourier || !billNumbers.trim()}
              className="h-10 px-4 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2 whitespace-nowrap"
              style={{ pointerEvents: submitting ? 'none' : 'auto' }}
            >
              {submitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                  <span className="hidden sm:inline">{existingParty ? 'Adding...' : 'Adding...'}</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline">{existingParty ? 'Add Bills' : 'Add Entry'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Today's Entries Table */}
      <div className="px-6 py-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Today's Entries</h3>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <style>
            {`
              @media print {
                body * { visibility: hidden; }
                .print-section, .print-section * { visibility: visible; }
                .print-section { position: absolute; left: 0; top: 0; width: 100%; }
                .no-print { display: none !important; }
                .print-header { display: block; text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid #000; }
              }
              .print-header { display: none; }
              @media print {
                .print-header { display: block; }
                .print-header h1 { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
                .print-header .contact-info { font-size: 14px; margin-bottom: 15px; line-height: 1.5; }
                .print-header .print-date { text-align: right; font-size: 14px; margin-top: 15px; }
                .print-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                .print-table th, .print-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                .print-table th { background-color: #f8f9fa; font-weight: bold; }
                @page { margin: 2cm; }
              }
            `}
          </style>

          <div className="print-section">
            <div className="print-header">
              <h1>{co.company_name}</h1>
              <div className="contact-info">
                <p>Parcel Dept: {co.parcel_dept_phone}</p>
                <p>Dept Head: {co.dept_head_phones}</p>
              </div>
              <div className="print-date">Date: {formatDate(currentDate)}</div>
            </div>

            <table className="min-w-full divide-y divide-gray-200 print-table">
              <thead className="bg-gray-50">
                <tr>
                  {['S.No', 'Time', 'Party Details', 'Address & Phone', 'Bill Numbers', 'Courier', 'Boxes'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6">
                      <LoadingSpinner size="sm" message="Loading entries..." />
                    </td>
                  </tr>
                ) : todayEntries.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">
                      No entries yet. Add your first entry above.
                    </td>
                  </tr>
                ) : (
                  getCurrentEntries().map((entry) => (
                    <tr
                      key={entry.id}
                      className={`transition-colors ${
                        existingParty?.id === entry.id
                          ? 'bg-red-50 border-l-4 border-red-400'
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-blue-600">
                        {entry.serialNumber}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                        {formatTime(new Date(entry.date))}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <p className="font-semibold text-gray-900">{entry.party_info?.party_name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">Code: {entry.party_code}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        <div>{entry.party_info?.address}</div>
                        {entry.party_info?.phone_number && (
                          <div className="flex items-center gap-1 text-gray-500 text-xs mt-0.5">
                            <Phone className="w-3 h-3" />
                            {entry.party_info.phone_number}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {entry.bill_numbers.join(', ')}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-800">
                        {entry.courier_agency?.agency_name}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 text-sm font-bold text-gray-700 bg-gray-100 rounded-md">
                          {entry.boxes}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Pagination */}
            {!loading && todayEntries.length > 0 && (
              <div className="px-4 py-3 flex items-center justify-between border-t border-gray-100 no-print">
                <div className="flex items-center gap-2">
                  <p className="text-xs text-gray-500">
                    Showing <span className="font-semibold text-gray-700">{displayInfo.start}</span>–<span className="font-semibold text-gray-700">{displayInfo.end}</span> of <span className="font-semibold text-gray-700">{displayInfo.total}</span>
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(0, prev - 1))}
                    disabled={currentPage === 0}
                    className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Previous
                  </button>
                  <span className="px-3 py-1.5 text-xs text-gray-500">
                    {currentPage + 1} / {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages - 1, prev + 1))}
                    disabled={currentPage >= totalPages - 1}
                    className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirm Dialog */}
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
    </div>
  );
}
