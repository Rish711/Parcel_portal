import React, { useState, useEffect } from 'react';
import { useAutoPageSize } from '../hooks/useAutoPageSize';
import { supabase, handleSupabaseError } from '../lib/supabase';
import { LoadingSpinner } from './ui/LoadingSpinner';
// *** START OF FIX ***
// Added the missing AlertTriangle icon to the import list.
import { Search, Download, Printer, FileText, X, ChevronLeft, ChevronRight, ArrowUpDown, AlertTriangle } from 'lucide-react';
// *** END OF FIX ***
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { formatDate, formatTime, formatDateTime } from '../lib/dateUtils';
import { useCompanySettings } from '../hooks/useCompanySettings';
import toast from 'react-hot-toast';

interface PartyInfo {
  party_code: string;
  party_name: string;
  address: string;
  phone_number?: string;
}

interface PartyLedgerEntry {
  id: string;
  date: string;
  party_code: string;
  party_name: string;
  address: string;
  phone_number?: string;
  bill_numbers: string[];
  boxes: number;
  courier_agency_name: string;
  created_at: string;
}

interface PartyKPIs {
  totalOrders: number;
  totalBills: number;
  totalBoxes: number;
  uniqueCouriers: number;
  firstOrderDate: string;
  lastOrderDate: string;
}

interface DateRange {
  startDate: string;
  endDate: string;
}

type SortField = 'date' | 'bill_numbers' | 'boxes' | 'courier_agency_name';
type SortDirection = 'asc' | 'desc';

export function PartyLedgerTab() {
  const { settings: co } = useCompanySettings();
  const [selectedParty, setSelectedParty] = useState<PartyInfo | null>(null);
  const [partyEntries, setPartyEntries] = useState<PartyLedgerEntry[]>([]);
  const [filteredEntries, setFilteredEntries] = useState<PartyLedgerEntry[]>([]);
  const [partyKPIs, setPartyKPIs] = useState<PartyKPIs | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDateSelected, setIsDateSelected] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>({ startDate: '', endDate: '' });

  // Modal state
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [modalSearchTerm, setModalSearchTerm] = useState('');
  const [modalStartDate, setModalStartDate] = useState('');
  const [modalEndDate, setModalEndDate] = useState('');
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = useAutoPageSize(44, 450); // auto-fit rows to viewport
  
  // Sorting
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  
  // Active tab
  const [activeTab, setActiveTab] = useState<'all' | 'recent' | 'summary'>('all');

  useEffect(() => {
    setIsDateSelected(!!(dateRange.startDate && dateRange.endDate));
  }, [dateRange]);

  useEffect(() => {
    // Keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.target as HTMLElement)?.id === 'party-search' && isDateSelected) {
        searchParty();
      }
      if (e.altKey && e.key === 'p') {
        e.preventDefault();
        printLedger();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [searchTerm, selectedParty, isDateSelected]);

  useEffect(() => {
    if (selectedParty) {
      loadParty();
    }
  }, [selectedParty, dateRange]);

  useEffect(() => {
    if (partyEntries.length > 0) {
      filterAndSortData();
    }
  }, [partyEntries, sortField, sortDirection, activeTab]);

  async function handleModalSearch() {
    if (!modalStartDate || !modalEndDate) {
      toast.error('Please select both start and end dates');
      return;
    }
    if (!modalSearchTerm.trim()) {
      toast.error('Please enter a party name or code');
      return;
    }
    if (new Date(modalEndDate) < new Date(modalStartDate)) {
      toast.error('End date cannot be before start date');
      return;
    }

    try {
      setLoading(true);

      const { data: partyInfo, error } = await supabase
        .from('party_information')
        .select('*')
        .or(`party_name.ilike.%${modalSearchTerm}%,party_code.ilike.%${modalSearchTerm}%`)
        .limit(1)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          toast.error('Party not found. Please check the name or code.');
        } else {
          throw error;
        }
        return;
      }

      // Commit dates and party from modal to main state
      setDateRange({ startDate: modalStartDate, endDate: modalEndDate });
      setSearchTerm(modalSearchTerm);
      setSelectedParty({
        party_code: partyInfo.party_code,
        party_name: partyInfo.party_name,
        address: partyInfo.address || 'No address available',
        phone_number: partyInfo.phone_number
      });
      setShowSearchModal(false);
      toast.success(`Found: ${partyInfo.party_name} (${partyInfo.party_code})`);

    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(`Search failed: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  }

  // kept for keyboard shortcut compatibility
  async function searchParty() {
    await handleModalSearch();
  }

  async function loadParty() {
    if (!selectedParty) return;

    try {
      setLoading(true);

      const startDate = new Date(dateRange.startDate);
      startDate.setHours(0, 0, 0, 0);

      const endDate = new Date(dateRange.endDate);
      endDate.setHours(23, 59, 59, 999);

      const { data: entries, error } = await supabase
        .from('party_list')
        .select(`
          *,
          party_info:party_information(*),
          courier_agency:courier_agency_list(*)
        `)
        .eq('party_code', selectedParty.party_code)
        .gte('date', startDate.toISOString())
        .lte('date', endDate.toISOString())
        .order('date', { ascending: false });

      if (error) throw error;

      const ledgerEntries: PartyLedgerEntry[] = (entries || []).map(entry => ({
        id: entry.id,
        date: entry.date,
        party_code: entry.party_code,
        party_name: entry.party_info?.party_name || selectedParty.party_name,
        address: entry.party_info?.address || selectedParty.address,
        bill_numbers: entry.bill_numbers || [],
        boxes: entry.boxes || 0,
        courier_agency_name: entry.courier_agency?.agency_name || 'Unknown Courier',
        created_at: entry.created_at
      }));

      setPartyEntries(ledgerEntries);
      renderKPIs(ledgerEntries);
      setCurrentPage(1);

      if (ledgerEntries.length === 0) {
        toast.error(`No transactions found for ${selectedParty.party_name} in the selected date range.`);
      } else {
        toast.success(`Loaded ${ledgerEntries.length} transactions for ${selectedParty.party_name}`);
      }

    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(`Failed to load party data: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  }

  function renderKPIs(entries: PartyLedgerEntry[]) {
    if (entries.length === 0) {
      setPartyKPIs(null);
      return;
    }

    const totalBills = entries.reduce((sum, entry) => sum + entry.bill_numbers.length, 0);
    const totalBoxes = entries.reduce((sum, entry) => sum + entry.boxes, 0);
    const uniqueCouriers = new Set(entries.map(entry => entry.courier_agency_name)).size;
    const sortedByDate = [...entries].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const kpis: PartyKPIs = {
      totalOrders: entries.length,
      totalBills,
      totalBoxes,
      uniqueCouriers,
      firstOrderDate: sortedByDate[0]?.date || '',
      lastOrderDate: sortedByDate[sortedByDate.length - 1]?.date || '',
    };

    setPartyKPIs(kpis);
  }

  function filterAndSortData() {
    let filtered = [...partyEntries];

    // Apply tab filter
    if (activeTab === 'recent') {
      const thirtyDaysAgo = subDays(new Date(), 30);
      filtered = filtered.filter(entry => new Date(entry.date) >= thirtyDaysAgo);
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let aValue: any, bValue: any;

      switch (sortField) {
        case 'date':
          aValue = new Date(a.date).getTime();
          bValue = new Date(b.date).getTime();
          break;
        case 'bill_numbers':
          aValue = a.bill_numbers.length;
          bValue = b.bill_numbers.length;
          break;
        case 'boxes':
          aValue = a.boxes;
          bValue = b.boxes;
          break;
        case 'courier_agency_name':
          aValue = a.courier_agency_name.toLowerCase();
          bValue = b.courier_agency_name.toLowerCase();
          break;
        default:
          return 0;
      }

      if (sortDirection === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });

    setFilteredEntries(filtered);
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  }

  function renderTable() {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedEntries = filteredEntries.slice(startIndex, endIndex);
    const totalPages = Math.ceil(filteredEntries.length / itemsPerPage);

    return (
      <div className="space-y-4">
        {/* Table */}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200" id="ledger-table">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  S.No
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('date')}
                >
                  <div className="flex items-center gap-1">
                    Date
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Time
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('bill_numbers')}
                >
                  <div className="flex items-center gap-1">
                    Bill Numbers
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('boxes')}
                >
                  <div className="flex items-center gap-1">
                    Boxes
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('courier_agency_name')}
                >
                  <div className="flex items-center gap-1">
                    Courier Service
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {paginatedEntries.map((entry, index) => (
                <tr key={entry.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">
                    {startIndex + index + 1}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatDate(new Date(entry.date))}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatTime(new Date(entry.date))}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    <div className="flex flex-wrap gap-1">
                      {entry.bill_numbers.map((bill, idx) => (
                        <span
                          key={idx}
                          className="inline-block bg-gray-100 border border-gray-200 px-2 py-1 rounded text-xs"
                        >
                          {bill}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <span className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs font-medium">
                      {entry.boxes}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {entry.courier_agency_name}
                  </td>
                </tr>
              ))}
              {/* Summary Row */}
              {paginatedEntries.length > 0 && (
                <tr className="bg-blue-50 border-t-2 border-blue-200 font-semibold">
                  <td className="px-6 py-4 text-sm text-blue-900" colSpan={3}>
                    Page Total ({paginatedEntries.length} entries)
                  </td>
                  <td className="px-6 py-4 text-sm text-blue-900">
                    {paginatedEntries.reduce((sum, entry) => sum + entry.bill_numbers.length, 0)} bills
                  </td>
                  <td className="px-6 py-4 text-sm text-blue-900">
                    {paginatedEntries.reduce((sum, entry) => sum + entry.boxes, 0)} boxes
                  </td>
                  <td className="px-6 py-4 text-sm text-blue-900">
                    {new Set(paginatedEntries.map(entry => entry.courier_agency_name)).size} couriers
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 bg-white border-t border-gray-200" id="pagination-controls">
            <div className="flex items-center gap-2">
              <p className="text-xs text-gray-500">
                <span className="font-semibold text-gray-700">{startIndex + 1}</span>–<span className="font-semibold text-gray-700">{Math.min(endIndex, filteredEntries.length)}</span> of <span className="font-semibold text-gray-700">{filteredEntries.length}</span>
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const pageNum = Math.max(1, Math.min(totalPages - 4, currentPage - 2)) + i;
                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`w-8 h-7 text-xs font-medium border rounded-lg transition-colors ${
                      currentPage === pageNum
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'border-gray-200 text-gray-600 bg-white hover:bg-gray-50'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function exportCSV() {
    if (!selectedParty || filteredEntries.length === 0) {
      toast.error('No data to export');
      return;
    }

    const csvRows = [
      ['Party Code', 'Party Name', 'Date', 'Time', 'Bill Numbers', 'Boxes', 'Courier Service']
    ];

    filteredEntries.forEach(entry => {
      csvRows.push([
        entry.party_code,
        entry.party_name,
        formatDate(new Date(entry.date)),
        formatTime(new Date(entry.date)),
        entry.bill_numbers.join('; '),
        entry.boxes.toString(),
        entry.courier_agency_name
      ]);
    });

    const csv = csvRows.map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `party_ledger_${selectedParty.party_code}_${activeTab}_${dateRange.startDate}_to_${dateRange.endDate}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    
    toast.success(`Exported ${filteredEntries.length} records for ${selectedParty.party_name}`);
  }

  function printLedger() {
    if (!selectedParty || !partyKPIs) {
      toast.error('No data to print');
      return;
    }

    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Party Ledger – ${selectedParty.party_name} (${selectedParty.party_code})</title>
          <style>
            @page { 
              size: A4; 
              margin: 2cm; 
              @bottom-center {
                content: "Page " counter(page) " of " counter(pages);
              }
            }
            
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            
            body { 
              font-family: Arial, sans-serif; 
              font-size: 12px; 
              line-height: 1.4;
            }
            
            .header { 
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 30px; 
              border-bottom: 2px solid #000; 
              padding-bottom: 20px; 
            }
            
            .logo-section {
              display: flex;
              align-items: center;
              gap: 15px;
            }
            
            .logo {
              width: 60px;
              height: 60px;
              background: #2563eb;
              border-radius: 8px;
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
              font-weight: bold;
              font-size: 20px;
            }
            
            .company-info h1 { 
              font-size: 24px; 
              margin-bottom: 5px; 
              color: #1e40af;
            }
            
            .company-info p { 
              font-size: 14px; 
              color: #666; 
            }
            
            .print-date {
              text-align: right;
              font-size: 12px;
              color: #666;
            }
            
            .party-title {
              text-align: center;
              margin: 20px 0;
              padding: 15px;
              background: #f8f9fa;
              border: 1px solid #dee2e6;
              border-radius: 8px;
            }
            
            .party-title h2 {
              font-size: 20px;
              color: #1e40af;
              margin-bottom: 5px;
            }
            
            .date-range {
              text-align: center;
              margin: 15px 0;
              font-size: 14px;
              color: #666;
            }
            
            .kpi-chips { 
              display: flex; 
              justify-content: center;
              flex-wrap: wrap;
              gap: 15px; 
              margin: 20px 0; 
              padding: 15px; 
              background: #f8f9fa; 
              border-radius: 8px;
            }
            
            .kpi-chip { 
              text-align: center; 
              padding: 10px 15px;
              background: white;
              border: 1px solid #dee2e6;
              border-radius: 6px;
              min-width: 100px;
            }
            
            .kpi-value { 
              font-size: 18px; 
              font-weight: bold; 
              color: #1e40af; 
              display: block;
            }
            
            .kpi-label { 
              font-size: 11px; 
              color: #666; 
              margin-top: 2px;
            }
            
            .table-container {
              margin: 20px 0;
            }
            
            table { 
              width: 100%; 
              border-collapse: collapse; 
              font-size: 11px;
            }
            
            th, td { 
              border: 1px solid #dee2e6; 
              padding: 8px 6px; 
              text-align: left; 
            }
            
            th { 
              background: #f8f9fa; 
              font-weight: bold; 
              color: #495057;
            }
            
            tbody tr:nth-child(even) {
              background: #f8f9fa;
            }
            
            tbody tr:nth-child(odd) {
              background: white;
            }
            
            .summary-row {
              background: #e3f2fd !important;
              font-weight: bold;
              color: #1565c0;
              border-top: 2px solid #1976d2;
            }
            
            .bill-numbers {
              font-size: 10px;
              max-width: 150px;
              word-wrap: break-word;
            }
            
            .boxes-cell {
              text-align: center;
              font-weight: bold;
            }
            
          .footer { 
              text-align: center; 
              font-size: 10px; 
              color: #666; 
              border-top: 1px solid #dee2e6;
              padding-top: 10px;
              margin-top: 40px; /* Adds space after the table */
            }
            
            @media print {
              .no-print { display: none !important; }
              body { -webkit-print-color-adjust: exact; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="logo-section">
              <div class="logo">SM</div>
              <div class="company-info">
                <h1>${co.company_name.toUpperCase()}</h1>
                <p>Parcel Department - ${co.address}</p>
                <p>Contact: ${co.parcel_dept_phone}</p>
              </div>
            </div>
            <div class="print-date">
              <p>Generated: ${formatDateTime(new Date())}</p>
              <p>Tab: ${activeTab.toUpperCase()}</p>
            </div>
          </div>
          
          <div class="party-title">
            <h2>Party Ledger – ${selectedParty.party_name} (${selectedParty.party_code})</h2>
            <p>${selectedParty.address}</p>
          </div>
          
          <div class="date-range">
            <strong>Date Range:</strong> ${formatDate(new Date(dateRange.startDate))} to ${formatDate(new Date(dateRange.endDate))}
          </div>
          
          <div class="kpi-chips">
            <div class="kpi-chip">
              <span class="kpi-value">${partyKPIs.totalOrders}</span>
              <div class="kpi-label">Total Orders</div>
            </div>
            <div class="kpi-chip">
              <span class="kpi-value">${partyKPIs.totalBills}</span>
              <div class="kpi-label">Total Bills</div>
            </div>
            <div class="kpi-chip">
              <span class="kpi-value">${partyKPIs.totalBoxes}</span>
              <div class="kpi-label">Total Boxes</div>
            </div>
            <div class="kpi-chip">
              <span class="kpi-value">${partyKPIs.uniqueCouriers}</span>
              <div class="kpi-label">Couriers Used</div>
            </div>
          </div>
          
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th style="width: 8%">S.No</th>
                  <th style="width: 12%">Date</th>
                  <th style="width: 10%">Time</th>
                  <th style="width: 30%">Bill Numbers</th>
                  <th style="width: 10%">Boxes</th>
                  <th style="width: 30%">Courier Service</th>
                </tr>
              </thead>
              <tbody>
                ${filteredEntries.map((entry, index) => `
                  <tr>
                    <td>${index + 1}</td>
                    <td>${formatDate(new Date(entry.date))}</td>
                    <td>${formatTime(new Date(entry.date))}</td>
                    <td class="bill-numbers">${entry.bill_numbers.join(', ')}</td>
                    <td class="boxes-cell">${entry.boxes}</td>
                    <td>${entry.courier_agency_name}</td>
                  </tr>
                `).join('')}
                <tr class="summary-row">
                  <td colspan="3"><strong>TOTAL (${filteredEntries.length} entries)</strong></td>
                  <td><strong>${filteredEntries.reduce((sum, entry) => sum + entry.bill_numbers.length, 0)} bills</strong></td>
                  <td class="boxes-cell"><strong>${filteredEntries.reduce((sum, entry) => sum + entry.boxes, 0)}</strong></td>
                  <td><strong>${new Set(filteredEntries.map(entry => entry.courier_agency_name)).size} unique couriers</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <div class="footer">
            <p>${co.company_name.toUpperCase()} - Party Ledger Report | Generated on ${formatDateTime(new Date())}</p>
          </div>
        </body>
      </html>
    `;

    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
      toast.error('Please allow popups to print');
      return;
    }

    printWindow.document.write(printContent);
    printWindow.document.close();
    
    printWindow.onload = function() {
      setTimeout(() => {
        printWindow.focus();
        printWindow.print();
        setTimeout(() => printWindow.close(), 1000);
        toast.success(`Printed ledger for ${selectedParty.party_name}`);
      }, 500);
    };
  }

  function resetSearch() {
    setSelectedParty(null);
    setPartyEntries([]);
    setFilteredEntries([]);
    setPartyKPIs(null);
    setSearchTerm('');
    setDateRange({ startDate: '', endDate: '' });
    setCurrentPage(1);
    setActiveTab('all');
    // Reset modal fields so next open starts fresh
    setModalSearchTerm('');
    setModalStartDate('');
    setModalEndDate('');
  }

  function openSearchModal() {
    // Pre-fill modal with current values if a search already ran
    setModalSearchTerm(searchTerm);
    setModalStartDate(dateRange.startDate);
    setModalEndDate(dateRange.endDate);
    setShowSearchModal(true);
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <LoadingSpinner size="lg" message="Loading party ledger data..." />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">

      {/* Search Modal */}
      {showSearchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Search className="w-4 h-4 text-blue-600" />
                Search Party Ledger
              </h3>
              <button
                onClick={() => setShowSearchModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    From Date <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    value={modalStartDate}
                    onChange={(e) => setModalStartDate(e.target.value)}
                    className="w-full h-10 px-3 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    To Date <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    value={modalEndDate}
                    onChange={(e) => setModalEndDate(e.target.value)}
                    className="w-full h-10 px-3 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Party Name or Code <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  value={modalSearchTerm}
                  onChange={(e) => setModalSearchTerm(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleModalSearch()}
                  placeholder="e.g. AARADHYA or 50459"
                  className="w-full h-10 px-3 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-400">Press Enter or click Search</p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50">
              <button
                onClick={() => setShowSearchModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleModalSearch}
                disabled={loading || !modalSearchTerm.trim() || !modalStartDate || !modalEndDate}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                Search
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            Party Ledger
          </h2>
          {selectedParty ? (
            <p className="text-sm text-gray-500 mt-0.5">
              {selectedParty.party_name} &middot; {dateRange.startDate} to {dateRange.endDate}
            </p>
          ) : (
            <p className="text-sm text-gray-400 mt-0.5">Search a party to view transactions</p>
          )}
        </div>
        <div className="flex items-center gap-2 no-print">
          <button
            onClick={openSearchModal}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Search className="w-4 h-4" />
            {selectedParty ? 'Change Search' : 'Search Party'}
          </button>
          {selectedParty && (
            <>
              <button
                onClick={exportCSV}
                disabled={filteredEntries.length === 0}
                title="Export CSV"
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg border border-gray-200 disabled:opacity-40 transition-colors"
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                onClick={printLedger}
                disabled={!partyKPIs}
                title="Print (Alt+P)"
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg border border-gray-200 disabled:opacity-40 transition-colors"
              >
                <Printer className="w-4 h-4" />
              </button>
              <button
                onClick={resetSearch}
                title="Clear"
                className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg border border-red-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-6 py-5">

        {/* Loading */}
        {loading && (
          <div className="py-12">
            <LoadingSpinner size="lg" message="Loading party data..." />
          </div>
        )}

        {/* Empty state — no party selected yet */}
        {!loading && !selectedParty && (
          <div className="text-center py-16">
            <Search className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-gray-700 mb-1">No party selected</h3>
            <p className="text-sm text-gray-400 mb-5">Click "Search Party" to pick a date range and find a party.</p>
            <button
              onClick={openSearchModal}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Search className="w-4 h-4" />
              Search Party
            </button>
          </div>
        )}

        {/* No results state */}
        {!loading && selectedParty && partyEntries.length === 0 && (
          <div className="text-center py-12 bg-yellow-50 rounded-lg border border-yellow-200">
            <AlertTriangle className="w-10 h-10 text-yellow-400 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-yellow-900 mb-1">No entries found</h3>
            <p className="text-sm text-gray-500">
              No transactions for <strong>{selectedParty.party_name}</strong> between{' '}
              {format(new Date(dateRange.startDate), 'dd/MM/yyyy')} and {format(new Date(dateRange.endDate), 'dd/MM/yyyy')}.
            </p>
            <button
              onClick={openSearchModal}
              className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
            >
              Change search
            </button>
          </div>
        )}

        {/* Results */}
        {!loading && selectedParty && partyEntries.length > 0 && (
          <div className="space-y-4">

            {/* Party info bar */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 bg-green-50 rounded-lg border border-green-200 text-sm">
              <span className="font-bold text-green-900">{selectedParty.party_name}</span>
              <span className="text-gray-500">Code: <span className="font-medium text-gray-700">{selectedParty.party_code}</span></span>
              {selectedParty.address && <span className="text-gray-500">{selectedParty.address}</span>}
              {selectedParty.phone_number && (
                <span className="flex items-center gap-1 text-gray-500">
                  <Search className="w-3 h-3" />{selectedParty.phone_number}
                </span>
              )}
            </div>

            {/* KPI chips */}
            {partyKPIs && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Orders', value: partyKPIs.totalOrders, color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
                  { label: 'Bills', value: partyKPIs.totalBills, color: 'text-green-700', bg: 'bg-green-50 border-green-200' },
                  { label: 'Boxes', value: partyKPIs.totalBoxes, color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
                  { label: 'Couriers', value: partyKPIs.uniqueCouriers, color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' },
                ].map(({ label, value, color, bg }) => (
                  <div key={label} className={`p-3 rounded-lg border ${bg} text-center`}>
                    <div className={`text-2xl font-bold ${color}`}>{value}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Tabs */}
            <div className="border-b border-gray-200 no-print">
              <nav className="-mb-px flex gap-6">
                {([
                  { key: 'all', label: `All Records (${partyEntries.length})` },
                  { key: 'recent', label: 'Recent 30 days' },
                  { key: 'summary', label: 'Summary' },
                ] as const).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={`py-2 px-1 border-b-2 text-sm font-medium transition-colors ${
                      activeTab === key
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </nav>
            </div>

            {/* Tab content */}
            {activeTab === 'summary' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Transaction Summary</h4>
                  <div className="space-y-2 text-sm">
                    {[
                      { label: 'First Order', value: partyKPIs ? formatDate(new Date(partyKPIs.firstOrderDate)) : '-' },
                      { label: 'Last Order', value: partyKPIs ? formatDate(new Date(partyKPIs.lastOrderDate)) : '-' },
                      { label: 'Total Orders', value: partyKPIs?.totalOrders ?? 0 },
                      { label: 'Total Bills', value: partyKPIs?.totalBills ?? 0 },
                      { label: 'Total Boxes', value: partyKPIs?.totalBoxes ?? 0 },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex justify-between">
                        <span className="text-gray-500">{label}</span>
                        <span className="font-semibold text-gray-800">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Couriers Used</h4>
                  <div className="space-y-2">
                    {Array.from(new Set(partyEntries.map(e => e.courier_agency_name))).map(courier => (
                      <div key={courier} className="flex justify-between text-sm">
                        <span className="text-gray-700">{courier}</span>
                        <span className="font-semibold text-gray-800">
                          {partyEntries.filter(e => e.courier_agency_name === courier).length} orders
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              renderTable()
            )}
          </div>
        )}
      </div>
    </div>
  );
}
