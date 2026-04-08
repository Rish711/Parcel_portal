import React, { useState, useEffect, useRef } from 'react';
import { supabase, handleSupabaseError } from '../lib/supabase';
import { useRealtimeSync, emitSyncEvent } from '../lib/realtimeSync';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { EditDialog } from './ui/EditDialog';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { Download, Edit, Printer, Trash2, Filter, X, RefreshCw, Package, Search, Phone, ClipboardList, FileText } from 'lucide-react';
import { useCompanySettings } from '../hooks/useCompanySettings';
import { format } from 'date-fns';
import { formatTime, formatDate, getCurrentDateTime } from '../lib/dateUtils';
import { regenerateBoxQRCodes } from '../lib/labelPersistence';
import toast from 'react-hot-toast';

interface HistoryEntry {
  id: string;
  date: string;
  party_code: string;
  bill_numbers: string[];
  boxes: number;
  courier_agency_id: string;
  party_info: {
    party_name: string;
    address: string;
    phone_number?: string;
  };
  courier_agency: {
    agency_name: string;
  };
  serialNumber?: number;
}

interface FilterOptions {
  startDate: string;
  endDate: string;
  courierService: string;
}

interface CourierSummary {
  agency_name: string;
  total_boxes: number;
  total_bills: number;
  total_orders: number;
}

type ViewMode = 'detailed' | 'reconciled';

interface ReconciledEntry {
  party_code: string;
  party_name: string;
  address: string;
  phone_number?: string;
  dispatch_count: number;
  total_bills: number;
  total_boxes: number;
  courier_services: string[];
  date_range: {
    first_date: string;
    last_date: string;
  };
  all_bill_numbers: string[];
}

export function HistoryTab() {
  const { settings: co } = useCompanySettings();
  const { dialogState, openConfirmDialog, handleConfirm, handleCancel } = useConfirmDialog();
  const today = format(new Date(), 'yyyy-MM-dd');
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingEntry, setEditingEntry] = useState<HistoryEntry | null>(null);
  const [courierAgencies, setCourierAgencies] = useState<{ id: string; agency_name: string; }[]>([]);
  const [selectedCourier, setSelectedCourier] = useState('');
  const [billNumbers, setBillNumbers] = useState('');
  const [boxes, setBoxes] = useState(0);
  const [filters, setFilters] = useState<FilterOptions>({
    startDate: today,
    endDate: today,
    courierService: ''
  });
  const [showFilters, setShowFilters] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [totalEntries, setTotalEntries] = useState(0);
  const [courierSummary, setCourierSummary] = useState<CourierSummary[]>([]);
  const [showCourierSummary, setShowCourierSummary] = useState(false);
  const [highlightedEntry, setHighlightedEntry] = useState<string | null>(null);
  const highlightedRef = useRef<HTMLTableRowElement>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [summaryFilter, setSummaryFilter] = useState<'all' | 'courier' | 'byhand'>('all');
  const [viewMode] = useState<ViewMode>('detailed');
  const [reconciledEntries] = useState<ReconciledEntry[]>([]);
  const [manualEndDateOverride, setManualEndDateOverride] = useState(false);

  // Track if we're showing a monthly filter with no results
  const isMonthlyFilterWithNoResults = () => {
    const startDate = new Date(filters.startDate);
    const endDate = new Date(filters.endDate);
    
    // Check if it's a single month filter (same month and year)
    const isSameMonth = startDate.getFullYear() === endDate.getFullYear() && 
                       startDate.getMonth() === endDate.getMonth();
    
    return isSameMonth && entries.length === 0 && !loading;
  };

  // Real-time sync setup
  useRealtimeSync(
    ['party_list'],
    async (event) => {
      if (event.source === 'party-list') {
        console.log('Real-time sync triggered in HistoryTab:', event);
        // Refresh history data when party list changes
        await fetchHistory();
      }
    },
    [filters]
  );

  const ITEMS_PER_PAGE = 1000; // Supabase fetch batch size

  useEffect(() => {
    if (highlightedEntry && highlightedRef.current) {
      highlightedRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }, [highlightedEntry]);

  useEffect(() => {
    const loadData = async () => {
      try {
        await Promise.all([
          fetchCourierAgencies(),
          fetchHistory()
        ]);
      } catch (error) {
        console.error('Failed to load initial data:', error);
      }
    };
    loadData();
  }, [filters]); // Re-fetch when filters change

  // Auto-show courier summary when courier service is filtered
  useEffect(() => {
    if (filters.courierService) {
      setShowCourierSummary(true);
    } else {
      setShowCourierSummary(false);
    }
  }, [filters.courierService]);

  // Helper function to check if courier is "By-Hand"
  const isByHandEntry = (courierName: string) => {
    const normalizedName = courierName.toLowerCase();
    return normalizedName.includes('by-hand') || normalizedName.includes('by hand') || normalizedName.includes('byhand');
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

  const handleBoxesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const numValue = value === '' ? 0 : parseInt(value) || 0;

    if (numValue > 50) {
      toast.error('Box limit exceeded. Maximum allowed boxes per party is 50.');
      setBoxes(50);
      return;
    }

    setBoxes(Math.max(0, Math.min(50, numValue)));
  };

  const handleBillNumbersChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setBillNumbers(value);

    const currentBills = value.split(',').map(num => num.trim()).filter(Boolean);
    const duplicates = currentBills.filter(bill => 
      entries.some(entry => entry.id !== editingEntry?.id && entry.bill_numbers.includes(bill))
    );

    if (duplicates.length > 0) {
      toast.error(`Warning: Bill number(s) ${duplicates.join(', ')} already exist in today's entries`, {
        duration: 5000,
      });
    }
  };

  const calculateCourierSummary = (entries: HistoryEntry[]) => {
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

  async function fetchCourierAgencies() {
    try {
      const { data, error } = await supabase
        .from('courier_agency_list')
        .select('id, agency_name')
        .order('agency_name');
      
      if (error) throw error;
      setCourierAgencies(data || []);
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(errorMessage);
    }
  }

  async function fetchHistory() {
    setLoading(true);
    try {
      const startDate = new Date(filters.startDate);
      startDate.setHours(0, 0, 0, 0);
      
      const endDate = new Date(filters.endDate);
      endDate.setHours(23, 59, 59, 999);

      // First, get the total count
      let countQuery = supabase
        .from('party_list')
        .select('*', { count: 'exact', head: true })
        .gte('date', startDate.toISOString())
        .lt('date', endDate.toISOString());

      if (filters.courierService) {
        countQuery = countQuery.eq('courier_agency_id', filters.courierService);
      }

      const { count, error: countError } = await countQuery;
      if (countError) throw countError;

      const totalEntries = count || 0;
      setTotalEntries(totalEntries);

      // Fetch all data in batches to avoid limits
      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        let query = supabase
          .from('party_list')
          .select(`
            *,
            party_info:party_information(*),
            courier_agency:courier_agency_list(*)
          `)
          .gte('date', startDate.toISOString())
          .lt('date', endDate.toISOString())
          .order('created_at', { ascending: true })
          .range(from, from + batchSize - 1);

        if (filters.courierService) {
          query = query.eq('courier_agency_id', filters.courierService);
        }

        const { data: batchData, error } = await query;
        if (error) throw error;

        if (batchData && batchData.length > 0) {
          allData = [...allData, ...batchData];
          from += batchSize;
          
          // Check if we've fetched all records
          hasMore = batchData.length === batchSize && allData.length < totalEntries;
          
          // Show progress for large datasets
          if (totalEntries > 2000) {
            toast.loading(`Loading entries: ${allData.length}/${totalEntries}`, {
              id: 'loading-progress'
            });
          }
        } else {
          hasMore = false;
        }
      }

      // Dismiss loading toast
      toast.dismiss('loading-progress');

      const partySerialNumbers = new Map();
      
      // No need for serialNumber processing - we'll use table index
      const processedData = allData;

      setEntries(processedData);
      setCourierSummary(calculateCourierSummary(processedData));
      
      // Success message for large datasets
      if (totalEntries > 2000) {
        toast.success(`Successfully loaded ${processedData.length} entries`, {
          duration: 3000
        });
      }
      
    } catch (error) {
      toast.dismiss('loading-progress');
      const errorMessage = handleSupabaseError(error);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdate() {
    if (!editingEntry) return;
    const oldBoxCount = editingEntry.boxes;

    // Validate box count before updating
    if (boxes < 1 || boxes > 50) {
      toast.error('Box limit exceeded. Maximum allowed boxes per party is 50.');
      return;
    }

    try {
      // Update party_list record in database
      // Note: The boxes field will be automatically synced to label_prints via database trigger
      const { error } = await supabase
        .from('party_list')
        .update({
          bill_numbers: billNumbers.split(',').map(num => num.trim()),
          boxes: boxes,
          courier_agency_id: selectedCourier,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingEntry.id);

      if (error) throw error;

      // Get updated courier agency data for sync event
      const updatedCourierAgency = courierAgencies.find(agency => agency.id === selectedCourier);

      const { data: labelRecord, error: labelFetchError } = await supabase
        .from('label_prints')
        .select('id, boxes')
        .eq('party_list_id', editingEntry.id)
        .maybeSingle();

      if (labelFetchError) {
        console.warn('Failed to fetch label_prints record before QR regeneration:', labelFetchError);
      }

      // Update label_prints record and then regenerate box QR codes using the
      // same app-side generator used by Label Print, so added boxes do not get
      // old suffix-style QR codes like BASE-003.
      const { error: labelUpdateError } = await supabase
        .from('label_prints')
        .update({
          bill_numbers: billNumbers.split(',').map(num => num.trim()),
          boxes: boxes,
          courier_agency_id: selectedCourier,
          transport: updatedCourierAgency?.agency_name || 'Unknown Transport',
          updated_at: new Date().toISOString()
        })
        .eq('party_list_id', editingEntry.id);

      if (labelUpdateError) {
        console.warn('Failed to update label_prints record:', labelUpdateError);
        // Don't fail the entire operation if label update fails
      }

      const { data: existingBoxQRCodes, error: boxQRFetchError } = labelRecord
        ? await supabase
            .from('box_qr_codes')
            .select('qr_code')
            .eq('label_print_id', labelRecord.id)
        : { data: null, error: null };

      if (boxQRFetchError) {
        console.warn('Failed to check existing box QR codes before regeneration:', boxQRFetchError);
      }

      const hasOldSuffixQRCode = (existingBoxQRCodes || []).some(box =>
        /-\d+$/.test(box.qr_code) || /-B\d+$/i.test(box.qr_code)
      );

      if (labelRecord && (oldBoxCount !== boxes || hasOldSuffixQRCode)) {
        await regenerateBoxQRCodes(labelRecord.id, boxes);
      }

      toast.success('Entry updated successfully');
      
      // Update the specific entry in-place without full refresh
      setEntries(prevEntries => 
        prevEntries.map(entry => 
          entry.id === editingEntry.id 
            ? {
                ...entry,
                bill_numbers: billNumbers.split(',').map(num => num.trim()),
                boxes: boxes,
                courier_agency_id: selectedCourier,
                courier_agency: updatedCourierAgency || entry.courier_agency,
                date: getCurrentDateTime()
              }
            : entry
        )
      );
      
      setEditingEntry(null);
      
      // Emit comprehensive sync event for all tabs to update
      emitSyncEvent('update', 'party_list', editingEntry.id, {
        id: editingEntry.id,
        party_code: editingEntry.party_code,
        party_name: editingEntry.party_info?.party_name,
        address: editingEntry.party_info?.address,
        courier_agency_id: selectedCourier,
        bill_numbers: billNumbers.split(',').map(num => num.trim()),
        boxes: boxes,
        courier_agency: updatedCourierAgency,
        transport: updatedCourierAgency?.agency_name || 'Unknown Transport',
        updated_at: new Date().toISOString()
      }, 'history');
      
      console.log(`[History] Database and sync event updated for party: ${editingEntry.party_code}`);
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(errorMessage);
    }
  }

  async function handleDelete(entryId: string) {
    const confirmed = await openConfirmDialog({
      title: 'Delete Record',
      message: 'Are you sure you want to delete this record? This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger'
    });
    
    if (!confirmed) return;

    toast.loading('Deleting record...', { id: 'delete-record' });
    try {
      // First, delete from label_prints table (this will cascade to scan_tally if needed)
      const { error: labelPrintsError } = await supabase
        .from('label_prints')
        .delete()
        .eq('party_list_id', entryId);

      if (labelPrintsError) {
        console.error('Error deleting label prints records:', labelPrintsError);
        throw labelPrintsError;
      }

      // Second, delete from analysis_table (historical data)
      const { error: analysisError } = await supabase
        .from('analysis_table')
        .delete()
        .eq('id', entryId);

      if (analysisError) {
        console.warn('Error deleting analysis records:', analysisError);
        // Continue even if analysis cleanup fails as it might not exist
      }

      // Finally, delete from party_list table (main record)
      const { error } = await supabase
        .from('party_list')
        .delete()
        .eq('id', entryId);

      if (error) throw error;
      
      toast.success('Record deleted successfully', { id: 'delete-record' });
      
      // Remove the specific entry in-place without full refresh
      setEntries(prevEntries => prevEntries.filter(entry => entry.id !== entryId));
      setTotalEntries(prev => prev - 1);
      
      // Emit events to notify other tabs of the deletion
      emitSyncEvent('delete', 'party_list', entryId, null, 'history');
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(errorMessage, { id: 'delete-record' });
    }
  }

  async function handleClearRecords() {
    const firstConfirm = await openConfirmDialog({
      title: 'Clear All Records',
      message: 'Are you sure you want to clear all records? This action cannot be undone.',
      confirmText: 'Continue',
      cancelText: 'Cancel',
      variant: 'danger'
    });
    
    if (!firstConfirm) return;

    const secondConfirm = await openConfirmDialog({
      title: 'Final Confirmation',
      message: 'This will permanently delete all party list records. Are you absolutely sure?',
      confirmText: 'Yes, Delete All',
      cancelText: 'Cancel',
      variant: 'danger'
    });
    
    if (!secondConfirm) return;

    toast.loading('Clearing all records...', { id: 'clear-records' });
    try {
      const { error } = await supabase
        .from('party_list')
        .delete()
        .not('id', 'is', null);

      if (error) throw error;

      toast.success('All records have been cleared', { id: 'clear-records' });
      await fetchHistory();
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(errorMessage, { id: 'clear-records' });
    }
  }

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        fetchCourierAgencies(),
        fetchHistory()
      ]);
      setHighlightedEntry(null);
      toast.success('Data refreshed successfully');
    } catch (error) {
      toast.error('Failed to refresh data');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch(searchTerm);
      setSearchTerm(''); // Clear input after search
    }
  };

  const handleSearch = async (term: string) => {
    if (!term) {
      setHighlightedEntry(null);
      return;
    }

    const matchingEntry = entries.find(entry => 
      entry.party_code.toLowerCase().includes(term.toLowerCase()) ||
      entry.party_info?.party_name.toLowerCase().includes(term.toLowerCase())
    );

    if (matchingEntry) {
      setHighlightedEntry(matchingEntry.id);
      const serial = entries.findIndex(entry => entry.id === matchingEntry.id) + 1;
      toast.success(`Found at Serial #${serial}`);

      // toast.success(`Found at Serial #${matchingEntry.serialNumber}`);
    } else {
      toast.error('No matching entries found');
      setHighlightedEntry(null);
    }
  };

  function handleDownload() {
    const csv = [
      ['Time', 'Party Code', 'Party Name', 'Bill Numbers', 'Courier Agency', 'Boxes'],
      ...entries.map(entry => [
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
    a.download = `party_list_history_${formatDate(new Date())}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  function handlePrint() {
    window.print();
  }

  const currentDate = new Date();

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">

      {/* Header */}
      <div className="flex flex-wrap justify-between items-center gap-3 px-6 py-4 border-b border-gray-100">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Transaction History</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            <span className="font-semibold text-blue-600">{totalEntries.toLocaleString()}</span> entries
            {totalEntries > 1000 && <span className="ml-1 text-gray-400">(all loaded)</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search party, press Enter"
              className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg w-56 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
          </div>

          {/* Date badge */}
          <div className="text-right pr-2 border-r border-gray-200">
            <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{format(currentDate, 'EEEE')}</div>
            <div className="text-sm font-bold text-gray-700">{formatDate(currentDate)}</div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="Refresh"
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShowCourierSummary(!showCourierSummary)}
              title={showCourierSummary ? 'Hide Summary' : 'Show Summary'}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                showCourierSummary ? 'bg-blue-50 text-blue-700 border-blue-200' : 'text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <Package className="w-4 h-4" />
              <span className="hidden sm:inline">{showCourierSummary ? 'Hide Summary' : 'Show Summary'}</span>
            </button>
            <button
              onClick={() => {
                setShowFilters(!showFilters);
                if (!showFilters) {
                  setFilters({ startDate: today, endDate: today, courierService: '' });
                  setManualEndDateOverride(false);
                }
              }}
              title="Filter"
              className={`p-2 rounded-lg border transition-colors ${
                showFilters ? 'bg-blue-50 text-blue-700 border-blue-200' : 'text-gray-500 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <Filter className="w-4 h-4" />
            </button>
            <button onClick={handleDownload} title="Download CSV" className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors">
              <Download className="w-4 h-4" />
            </button>
            <button onClick={handlePrint} title="Print" className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors">
              <Printer className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Courier Summary */}
      {(showCourierSummary || filters.courierService) && courierSummary.length > 0 && (
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
                    summaryFilter === f ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {f === 'all' ? 'All' : f === 'courier' ? 'Courier' : 'By-Hand'}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mb-3">
            {getFilteredCourierSummary().map((summary) => (
              <div key={summary.agency_name} className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                <p className="text-sm font-bold text-gray-900 leading-tight mb-2">{summary.agency_name}</p>
                <div className="grid grid-cols-3 gap-1 text-center">
                  <div>
                    <ClipboardList className="w-4 h-4 mx-auto mb-1 text-blue-500" />
                    <div className="text-sm font-bold text-blue-700">{summary.total_orders}</div>
                    <div className="text-xs text-gray-400">Orders</div>
                  </div>
                  <div>
                    <FileText className="w-4 h-4 mx-auto mb-1 text-green-500" />
                    <div className="text-sm font-bold text-green-700">{summary.total_bills}</div>
                    <div className="text-xs text-gray-400">Bills</div>
                  </div>
                  <div>
                    <Package className="w-4 h-4 mx-auto mb-1 text-purple-500" />
                    <div className="text-sm font-bold text-purple-700">{summary.total_boxes}</div>
                    <div className="text-xs text-gray-400">Boxes</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500">
            <span className="font-semibold text-gray-700">{totalEntries.toLocaleString()}</span> total entries &middot; {filters.startDate} to {filters.endDate}
          </p>
          {getFilteredCourierSummary().length === 0 && (
            <p className="text-sm text-center text-gray-400 py-3">No {summaryFilter === 'byhand' ? 'by-hand' : 'courier'} entries found</p>
          )}
        </div>
      )}

      {/* Filters Panel */}
      {showFilters && (
        <div className="border-b border-gray-100 px-6 py-4 bg-slate-50 no-print">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Filter Records</h3>
            <button
              onClick={() => { setShowFilters(false); setFilters({ startDate: today, endDate: today, courierService: '' }); }}
              className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Start Date</label>
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                className="w-full h-9 px-3 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">End Date</label>
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                className="w-full h-9 px-3 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Courier Service</label>
              <select
                value={filters.courierService}
                onChange={(e) => setFilters({ ...filters, courierService: e.target.value })}
                className="w-full h-9 px-3 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Couriers</option>
                {courierAgencies.map((agency) => (
                  <option key={agency.id} value={agency.id}>{agency.agency_name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <style>{`
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
            .print-courier-summary { max-width: 500px; margin: 20px auto; padding: 10px; border: 2px solid #333; border-radius: 8px; background-color: #f8f9fa; page-break-inside: avoid; }
            .print-courier-summary h3 { font-size: 18px; font-weight: bold; margin-bottom: 15px; text-align: center; text-transform: uppercase; letter-spacing: 1px; }
            .print-courier-summary .summary-item { font-size: 14px; margin: 8px 0; padding: 8px; border: 1px solid #ddd; border-radius: 4px; background-color: #fff; }
            .print-courier-summary .summary-item h4 { font-weight: bold; margin: 0 0 6px 0; font-size: 16px; text-decoration: underline; }
            .print-courier-summary .summary-inline { display: inline-block; margin-right: 20px; font-weight: bold; font-size: 20px; }
            .print-table { width: 100%; border-collapse: collapse; margin-top: 20px; page-break-inside: auto; }
            .print-table tr { page-break-inside: avoid; page-break-after: auto; }
            .print-table th, .print-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            .print-table th { background-color: #f8f9fa; font-weight: bold; }
            @page { margin: 2cm; }
            .time-column { display: none; }
            .highlighted-row { background-color: transparent !important; }
          }
          .highlighted-row { background-color: #eff6ff !important; border-left: 3px solid #3b82f6; }
          .print-courier-summary { display: none; }
          @media print { .print-courier-summary { display: block; } }
        `}</style>

        <div className="print-section">
          {/* Print header (hidden on screen) */}
          <div className="print-header">
            <h1>{co.company_name}</h1>
            <div className="contact-info">
              <p>Parcel Dept: {co.parcel_dept_phone}</p>
              <p>Dept Head: {co.dept_head_phones}</p>
            </div>
            <div className="print-date">Date: {formatDate(new Date())}</div>
          </div>

          {/* Print courier summary */}
          {(showCourierSummary || filters.courierService) && courierSummary.length > 0 && (
            <div className="print-courier-summary">
              <h3 className="print-summary-title">Courier Services Summary</h3>
              {getFilteredCourierSummary().map((summary) => (
                <div key={summary.agency_name} className="summary-item">
                  <h4>{summary.agency_name}</h4>
                  <div>
                    <span className="summary-inline">Orders: <span className="summary-value">{summary.total_orders}</span></span>
                    <span className="summary-inline">Bills: <span className="summary-value">{summary.total_bills}</span></span>
                    <span className="summary-inline">Boxes: <span className="summary-value">{summary.total_boxes}</span></span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {viewMode === 'reconciled' ? (
            /* Reconciled View */
            <div>
              <div className="mb-4 p-4 bg-blue-50 rounded-lg no-print">
                <h3 className="text-sm font-semibold text-blue-900 mb-3 uppercase tracking-wide">Reconciled Summary</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Unique Parties', value: reconciledEntries.length, color: 'text-blue-700' },
                    { label: 'Total Dispatches', value: reconciledEntries.reduce((s, e) => s + e.dispatch_count, 0), color: 'text-green-700' },
                    { label: 'Total Bills', value: reconciledEntries.reduce((s, e) => s + e.total_bills, 0), color: 'text-purple-700' },
                    { label: 'Total Boxes', value: reconciledEntries.reduce((s, e) => s + e.total_boxes, 0), color: 'text-orange-700' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-white rounded-lg p-3 text-center border border-blue-100">
                      <div className={`text-2xl font-bold ${color}`}>{value}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                    </div>
                  ))}
                </div>
              </div>
              <table className="min-w-full divide-y divide-gray-200 print-table">
                <thead className="bg-gray-50">
                  <tr>
                    {['S.No', 'Party Details', 'Address', 'Dispatches', 'Total Bills', 'Total Boxes', 'Courier Services', 'Date Range'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {loading ? (
                    <tr><td colSpan={8} className="px-4 py-6"><LoadingSpinner size="sm" message="Loading data..." /></td></tr>
                  ) : reconciledEntries.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">
                      {isMonthlyFilterWithNoResults() ? "This month's data may have been deleted." : "No entries found."}
                    </td></tr>
                  ) : reconciledEntries.map((entry, index) => (
                    <tr key={entry.party_code} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-sm font-semibold text-blue-600">{index + 1}</td>
                      <td className="px-4 py-3 text-sm">
                        <p className="font-semibold text-gray-900">{entry.party_name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">Code: {entry.party_code}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        <div>{entry.address}</div>
                        {entry.phone_number && (
                          <div className="flex items-center gap-1 text-gray-400 text-xs mt-0.5">
                            <Phone className="w-3 h-3" />{entry.phone_number}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full text-xs font-semibold">
                          {entry.dispatch_count}x
                        </span>
                        {entry.dispatch_count > 1 && <span className="ml-1 text-xs text-orange-500">Multiple</span>}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-800">{entry.total_bills}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-800">{entry.total_boxes}</td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex flex-wrap gap-1">
                          {entry.courier_services.map((service, idx) => (
                            <span key={idx} className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs">{service}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        <div>{format(new Date(entry.date_range.first_date), 'dd/MM/yy')}</div>
                        <div className="text-gray-300">—</div>
                        <div>{format(new Date(entry.date_range.last_date), 'dd/MM/yy')}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            /* Detailed View */
            <table className="min-w-full divide-y divide-gray-200 print-table">
              <thead className="bg-gray-50">
                <tr>
                  {['S.No', 'Time', 'Party Details', 'Address', 'Bill Numbers', 'Courier', 'Boxes', 'Actions'].map((h) => (
                    <th
                      key={h}
                      className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap ${
                        h === 'Time' ? 'time-column' : ''
                      } ${h === 'Actions' ? 'no-print' : ''}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-6"><LoadingSpinner size="sm" message="Loading data..." /></td></tr>
                ) : entries.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">No entries found for this period.</td></tr>
                ) : (
                  entries.map((entry) => (
                    <tr
                      key={entry.id}
                      ref={entry.id === highlightedEntry ? highlightedRef : null}
                      className={`transition-colors ${entry.id === highlightedEntry ? 'highlighted-row' : 'hover:bg-gray-50'}`}
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-blue-600">
                        {entries.indexOf(entry) + 1}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 time-column">
                        {formatTime(new Date(entry.date))}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <p className="font-semibold text-gray-900">{entry.party_info?.party_name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">Code: {entry.party_code}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        <div>{entry.party_info?.address}</div>
                        {entry.party_info?.phone_number && (
                          <div className="flex items-center gap-1 text-gray-400 text-xs mt-0.5">
                            <Phone className="w-3 h-3" />{entry.party_info.phone_number}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {entry.bill_numbers.join(', ')}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-800 font-medium">
                        {entry.courier_agency?.agency_name}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 text-sm font-bold text-gray-700 bg-gray-100 rounded-md">
                          {entry.boxes}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap no-print">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setEditingEntry(entry);
                              setBillNumbers(entry.bill_numbers.join(', '));
                              setBoxes(entry.boxes);
                              setSelectedCourier(entry.courier_agency_id);
                            }}
                            title="Edit"
                            className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(entry.id)}
                            title="Delete"
                            className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <EditDialog
        open={!!editingEntry}
        title={`Edit Entry${editingEntry?.party_info?.party_name ? ` - ${editingEntry.party_info.party_name}` : ''}`}
        onClose={() => setEditingEntry(null)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setEditingEntry(null)}
              className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleUpdate}
              className="px-4 py-2 text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              Save Changes
            </button>
          </>
        }
        maxWidthClass="max-w-2xl"
      >
        {editingEntry && (
          <div className="space-y-4">
            <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-800">
              <div className="font-semibold">{editingEntry.party_info?.party_name}</div>
              <div>Party Code: {editingEntry.party_code}</div>
              <div>{editingEntry.party_info?.address}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Bill Numbers
              </label>
              <input
                type="text"
                value={billNumbers}
                onChange={handleBillNumbersChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Courier
                </label>
                <select
                  value={selectedCourier}
                  onChange={(e) => setSelectedCourier(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {courierAgencies.map((agency) => (
                    <option key={agency.id} value={agency.id}>{agency.agency_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Boxes
                </label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={boxes}
                  onChange={handleBoxesChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        )}
      </EditDialog>

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
