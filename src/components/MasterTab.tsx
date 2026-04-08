import React, { useState, useEffect } from 'react';
import { useAutoPageSize } from '../hooks/useAutoPageSize';
import { supabase, handleSupabaseError } from '../lib/supabase';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { Users, Building2, Plus, Edit, Trash2, Search, X, RefreshCw, Save, ChevronLeft, ChevronRight, Phone } from 'lucide-react';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { EditDialog } from './ui/EditDialog';
import toast from 'react-hot-toast';

interface PartyInfo {
  party_code: string;
  party_name: string;
  address: string;
  phone_number?: string;
  updated_at?: string;
}

interface CourierAgency {
  id: string;
  agency_number: string;
  agency_name: string;
  created_at: string;
  updated_at?: string;
}

interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  startIndex: number;
  endIndex: number;
}

export function MasterTab() {
  const { dialogState, openConfirmDialog, handleConfirm, handleCancel } = useConfirmDialog();
  const [activeSubTab, setActiveSubTab] = useState<'parties' | 'couriers'>('parties');
  const [parties, setParties] = useState<PartyInfo[]>([]);
  const [couriers, setCouriers] = useState<CourierAgency[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<PartyInfo[]>([]);
  const [isInSearchMode, setIsInSearchMode] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);
  
  const partiesPageSize = useAutoPageSize(44, 370); // auto-fit rows to viewport
  // Pagination state for parties
  const [partiesPagination, setPartiesPagination] = useState<PaginationInfo>({
    currentPage: 1,
    totalPages: 0,
    totalCount: 0,
    pageSize: 50,
    startIndex: 0,
    endIndex: 0
  });
  
  // Party form state
  const [editingParty, setEditingParty] = useState<PartyInfo | null>(null);
  const [partyFormData, setPartyFormData] = useState({ party_code: '', party_name: '', address: '', phone_number: '' });
  
  // Courier form state
  const [editingCourier, setEditingCourier] = useState<CourierAgency | null>(null);
  const [courierFormData, setCourierFormData] = useState({ agency_name: '', agency_number: '' });

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (activeSubTab === 'parties') {
      if (isInSearchMode) return;
      loadPartiesPage(1);
    }
  }, [activeSubTab]);

  // Re-fetch when auto page size changes (viewport resize)
  useEffect(() => {
    if (!isInSearchMode) {
      loadPartiesPage(1, partiesPageSize);
    }
  }, [partiesPageSize]);

  // Debounced search effect
  useEffect(() => {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    if (searchTerm.trim()) {
      const timeout = setTimeout(() => {
        performSearch();
      }, 300);
      setSearchTimeout(timeout);
    } else {
      // Clear search and return to pagination
      if (isInSearchMode) {
        setIsInSearchMode(false);
        setSearchResults([]);
        loadPartiesPage(1);
      }
    }

    return () => {
      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }
    };
  }, [searchTerm]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      await Promise.all([loadPartiesPage(1), loadCouriers()]);
    } catch (error) {
      console.error('Error loading initial data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const loadPartiesPage = async (page: number, pageSize?: number) => {
    const size = pageSize ?? partiesPageSize;
    try {
      setLoading(true);

      // Calculate offset
      const offset = (page - 1) * size;

      // Get total count
      const { count, error: countError } = await supabase
        .from('party_information')
        .select('*', { count: 'exact', head: true });

      if (countError) throw countError;

      // Get paginated data
      const { data, error } = await supabase
        .from('party_information')
        .select('*')
        .order('party_name')
        .range(offset, offset + size - 1);

      if (error) throw error;

      setParties(data || []);

      // Update pagination info
      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / size);
      const startIndex = totalCount > 0 ? offset + 1 : 0;
      const endIndex = Math.min(offset + size, totalCount);

      setPartiesPagination({
        currentPage: page,
        totalPages,
        totalCount,
        pageSize: size,
        startIndex,
        endIndex
      });
      
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(`Failed to load parties: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const performSearch = async () => {
    if (!searchTerm.trim()) return;
    
    try {
      setIsSearching(true);
      
      const { data, error } = await supabase
        .from('party_information')
        .select('*')
        .or(`party_code.ilike.%${searchTerm}%,party_name.ilike.%${searchTerm}%,address.ilike.%${searchTerm}%`)
        .order('party_name')
        .limit(200);
      
      if (error) throw error;
      
      setSearchResults(data || []);
      setIsInSearchMode(true);
      
      if (data && data.length === 0) {
        toast.error(`No parties found matching "${searchTerm}"`);
      } else {
        toast.success(`Found ${data?.length || 0} parties matching "${searchTerm}"`);
      }
      
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(`Search failed: ${errorMessage}`);
    } finally {
      setIsSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchTerm('');
    setIsInSearchMode(false);
    setSearchResults([]);
    loadPartiesPage(1);
    toast.success('Search cleared - showing all parties');
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= partiesPagination.totalPages) {
      loadPartiesPage(newPage);
    }
  };

  const loadCouriers = async () => {
    try {
      const { data, error } = await supabase
        .from('courier_agency_list')
        .select('*')
        .order('agency_name');

      if (error) throw error;
      setCouriers(data || []);
    } catch (error) {
      toast.error('Failed to load couriers');
    }
  };

  // Party management functions
  const handlePartySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (editingParty) {
        const { error } = await supabase
          .from('party_information')
          .update({
            party_name: partyFormData.party_name,
            address: partyFormData.address,
            phone_number: partyFormData.phone_number || null
          })
          .eq('party_code', editingParty.party_code);

        if (error) throw error;
        toast.success('Party updated successfully');
      } else {
        const { error } = await supabase
          .from('party_information')
          .insert([{
            ...partyFormData
          }]);

        if (error) throw error;
        toast.success('Party added successfully');
      }

      resetPartyForm();
      if (isInSearchMode) {
        await performSearch();
      } else {
        await loadPartiesPage(partiesPagination.currentPage);
      }
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(editingParty ? `Failed to update party: ${errorMessage}` : `Failed to add party: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePartyDelete = async (partyCode: string) => {
    const confirmed = await openConfirmDialog({
      title: 'Delete Party',
      message: `Are you sure you want to delete party "${partyCode}"? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger'
    });
    
    if (!confirmed) return;

    toast.loading('Deleting party...', { id: 'delete-party' });
    setLoading(true);
    try {
      const { error } = await supabase
        .from('party_information')
        .delete()
        .eq('party_code', partyCode);

      if (error) throw error;
      toast.success('Party deleted successfully', { id: 'delete-party' });
      if (isInSearchMode) {
        await performSearch();
      } else {
        await loadPartiesPage(partiesPagination.currentPage);
      }
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(`Failed to delete party: ${errorMessage}`, { id: 'delete-party' });
    } finally {
      setLoading(false);
    }
  };

  const resetPartyForm = () => {
    setPartyFormData({ party_code: '', party_name: '', address: '', phone_number: '' });
    setEditingParty(null);
    setShowAddForm(false);
  };

  // Courier management functions
  const handleCourierSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate required fields
    const agencyNumber = courierFormData.agency_number.trim();
    const agencyName = courierFormData.agency_name.trim();

    if (!agencyNumber) {
      toast.error('Agency Number is required');
      return;
    }

    if (!agencyName) {
      toast.error('Agency Name is required');
      return;
    }

    setLoading(true);

    try {
      if (editingCourier) {
        // When editing, only check for duplicate name (different courier)
        const { data: existingByName } = await supabase
          .from('courier_agency_list')
          .select('id')
          .eq('agency_name', agencyName)
          .neq('id', editingCourier.id)
          .maybeSingle();

        if (existingByName) {
          toast.error('A courier with this name already exists');
          setLoading(false);
          return;
        }

        const { error } = await supabase
          .from('courier_agency_list')
          .update({
            agency_name: agencyName,
            updated_at: new Date().toISOString()
          })
          .eq('id', editingCourier.id);

        if (error) throw error;
        toast.success('Courier updated successfully');
      } else {
        // When adding, check for duplicate agency number and name
        const { data: existingByNumber } = await supabase
          .from('courier_agency_list')
          .select('id')
          .eq('agency_number', agencyNumber)
          .maybeSingle();

        if (existingByNumber) {
          toast.error('A courier with this agency number already exists');
          setLoading(false);
          return;
        }

        const { data: existingByName } = await supabase
          .from('courier_agency_list')
          .select('id')
          .eq('agency_name', agencyName)
          .maybeSingle();

        if (existingByName) {
          toast.error('A courier with this name already exists');
          setLoading(false);
          return;
        }

        const { error } = await supabase
          .from('courier_agency_list')
          .insert([{
            agency_number: agencyNumber,
            agency_name: agencyName,
            created_at: new Date().toISOString()
          }]);

        if (error) throw error;
        toast.success('Courier added successfully');
      }

      resetCourierForm();
      await loadCouriers();
    } catch (error: any) {
      console.error('Courier save error:', error);
      let errorMessage = 'An unexpected error occurred';

      if (error.code === '23505') {
        if (error.message.includes('agency_number')) {
          errorMessage = 'A courier with this agency number already exists';
        } else if (error.message.includes('agency_name')) {
          errorMessage = 'A courier with this name already exists';
        } else {
          errorMessage = 'This courier already exists';
        }
      } else if (error.message) {
        errorMessage = error.message;
      }

      toast.error(editingCourier ? `Failed to update courier: ${errorMessage}` : `Failed to add courier: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCourierDelete = async (courierId: string) => {
    const courier = couriers.find(c => c.id === courierId);
    const courierName = courier?.agency_name || 'this courier';
    
    const confirmed = await openConfirmDialog({
      title: 'Delete Courier',
      message: `Are you sure you want to delete "${courierName}"? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger'
    });
    
    if (!confirmed) return;

    toast.loading('Deleting courier...', { id: 'delete-courier' });
    setLoading(true);
    try {
      const { error } = await supabase
        .from('courier_agency_list')
        .delete()
        .eq('id', courierId);

      if (error) throw error;
      toast.success('Courier deleted successfully', { id: 'delete-courier' });
      await loadCouriers();
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(`Failed to delete courier: ${errorMessage}`, { id: 'delete-courier' });
    } finally {
      setLoading(false);
    }
  };

  const resetCourierForm = () => {
    setCourierFormData({ agency_name: '', agency_number: '' });
    setEditingCourier(null);
    setShowAddForm(false);
  };

  // Get current parties to display (either search results or paginated data)
  const currentParties = isInSearchMode ? searchResults : parties;

  const filteredCouriers = couriers.filter(courier =>
    courier.agency_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    courier.agency_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const inputCls = 'h-10 w-full px-3 text-sm text-gray-900 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500';
  const labelCls = 'block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1.5';

  const renderPartiesTab = () => (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isSearching ? 'text-blue-500' : 'text-gray-400'}`} />
          <input
            type="text"
            placeholder="Search by code, name or address..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-10 w-full pl-9 pr-9 text-sm text-gray-900 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {isSearching && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" />
            </div>
          )}
          {searchTerm && !isSearching && (
            <button onClick={clearSearch} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          onClick={() => { setEditingParty(null); setPartyFormData({ party_code: '', party_name: '', address: '', phone_number: '' }); setShowAddForm(true); }}
          className="h-10 px-4 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 flex items-center gap-2 shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add Party
        </button>
        <button
          onClick={() => isInSearchMode ? performSearch() : loadPartiesPage(partiesPagination.currentPage)}
          disabled={loading}
          className="h-10 w-10 flex items-center justify-center border border-gray-300 rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-40 shrink-0"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <EditDialog
        open={showAddForm}
        title={editingParty ? 'Edit Party' : 'Add New Party'}
        onClose={resetPartyForm}
        maxWidthClass="max-w-4xl"
      >
          <form onSubmit={handlePartySubmit}>
            <div className="space-y-4 mb-4">
              <div>
                <label className={labelCls}>Party Name <span className="text-red-400">*</span></label>
                <input type="text" required value={partyFormData.party_name}
                  onChange={(e) => setPartyFormData({ ...partyFormData, party_name: e.target.value })}
                  className={inputCls} placeholder="Full name" />
              </div>
              <div>
                <label className={labelCls}>Address <span className="text-red-400">*</span></label>
                <input type="text" required value={partyFormData.address}
                  onChange={(e) => setPartyFormData({ ...partyFormData, address: e.target.value })}
                  className={inputCls} placeholder="City / Area" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Party Code <span className="text-red-400">*</span></label>
                  <input type="text" required disabled={!!editingParty} value={partyFormData.party_code}
                    onChange={(e) => setPartyFormData({ ...partyFormData, party_code: e.target.value })}
                    className={inputCls} placeholder="e.g. PTY001" />
                </div>
                <div>
                  <label className={labelCls}>Phone</label>
                  <input type="text" value={partyFormData.phone_number}
                    onChange={(e) => setPartyFormData({ ...partyFormData, phone_number: e.target.value })}
                    className={inputCls} placeholder="Optional" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={resetPartyForm}
                className="h-9 px-4 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100">
                Cancel
              </button>
              <button type="submit" disabled={loading}
                className="h-9 px-4 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                <Save className="w-3.5 h-3.5" />
                {editingParty ? 'Update' : 'Save'}
              </button>
            </div>
          </form>
      </EditDialog>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-semibold text-gray-700">Parties</span>
            <span className="text-xs bg-blue-100 text-blue-700 font-semibold px-2 py-0.5 rounded-full">
              {isInSearchMode ? searchResults.length : partiesPagination.totalCount}
            </span>
            {isInSearchMode && (
              <span className="text-xs text-blue-600 ml-1">
                — results for &ldquo;{searchTerm}&rdquo;
              </span>
            )}
          </div>
          {isInSearchMode && (
            <button onClick={clearSearch} className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1">
              <X className="w-3 h-3" /> Clear search
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Code</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Party Name</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Address</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Phone</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={5} className="py-12 text-center"><LoadingSpinner size="lg" message="Loading parties..." /></td></tr>
              ) : currentParties.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-gray-400">
                    <Users className="w-10 h-10 mx-auto mb-2 text-gray-200" />
                    <p className="text-sm">No parties found</p>
                    {isInSearchMode && <p className="text-xs mt-1">Try adjusting your search</p>}
                  </td>
                </tr>
              ) : currentParties.map((party) => (
                <tr key={party.party_code} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-sm font-semibold text-gray-800">{party.party_code}</td>
                  <td className="px-4 py-3 text-sm text-gray-800">{party.party_name}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{party.address}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {party.phone_number ? (
                      <span className="flex items-center gap-1">
                        <Phone className="w-3 h-3 text-gray-400" />
                        {party.phone_number}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => { setEditingParty(party); setPartyFormData({ party_code: party.party_code, party_name: party.party_name, address: party.address, phone_number: party.phone_number || '' }); setShowAddForm(true); }}
                        className="p-1.5 rounded border border-gray-200 text-blue-600 hover:bg-blue-50 hover:border-blue-300 transition-colors"
                        title="Edit"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handlePartyDelete(party.party_code)}
                        className="p-1.5 rounded border border-gray-200 text-red-500 hover:bg-red-50 hover:border-red-300 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!isInSearchMode && partiesPagination.totalPages > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-600">
                {partiesPagination.startIndex}–{partiesPagination.endIndex} of {partiesPagination.totalCount}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePageChange(partiesPagination.currentPage - 1)}
                disabled={partiesPagination.currentPage === 1 || loading}
                className="h-8 px-3 text-xs border border-gray-300 rounded-lg text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-40 flex items-center gap-1"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </button>
              <span className="text-xs text-gray-600 font-medium px-2">
                {partiesPagination.currentPage} / {partiesPagination.totalPages}
              </span>
              <button
                onClick={() => handlePageChange(partiesPagination.currentPage + 1)}
                disabled={partiesPagination.currentPage === partiesPagination.totalPages || loading}
                className="h-8 px-3 text-xs border border-gray-300 rounded-lg text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-40 flex items-center gap-1"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {isInSearchMode && (
          <div className="px-4 py-3 border-t border-blue-100 bg-blue-50 flex items-center justify-between">
            <span className="text-xs text-blue-700">{searchResults.length} results (max 200)</span>
            <button onClick={clearSearch} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
              Show all parties
            </button>
          </div>
        )}
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
    </div>
  );

  const renderCouriersTab = () => (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search couriers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-10 w-full pl-9 pr-4 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <button
          onClick={() => { setEditingCourier(null); setCourierFormData({ agency_name: '', agency_number: '' }); setShowAddForm(true); }}
          className="h-10 px-4 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 flex items-center gap-2 shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add Courier
        </button>
        <button
          onClick={loadCouriers}
          disabled={loading}
          className="h-10 w-10 flex items-center justify-center border border-gray-300 rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-40 shrink-0"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <EditDialog
        open={showAddForm}
        title={editingCourier ? 'Edit Courier' : 'Add New Courier'}
        onClose={resetCourierForm}
        maxWidthClass="max-w-2xl"
      >
          <form onSubmit={handleCourierSubmit}>
            <div className="space-y-4 mb-4">
              <div>
                <label className={labelCls}>Agency Number <span className="text-red-400">*</span></label>
                <input type="text" required disabled={!!editingCourier} value={courierFormData.agency_number}
                  onChange={(e) => setCourierFormData({ ...courierFormData, agency_number: e.target.value })}
                  className={inputCls} placeholder="e.g. AG001" />
              </div>
              <div>
                <label className={labelCls}>Agency Name <span className="text-red-400">*</span></label>
                <input type="text" required value={courierFormData.agency_name}
                  onChange={(e) => setCourierFormData({ ...courierFormData, agency_name: e.target.value })}
                  className={inputCls} placeholder="e.g. DTDC" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={resetCourierForm}
                className="h-9 px-4 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100">
                Cancel
              </button>
              <button type="submit" disabled={loading}
                className="h-9 px-4 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                <Save className="w-3.5 h-3.5" />
                {editingCourier ? 'Update' : 'Save'}
              </button>
            </div>
          </form>
      </EditDialog>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-semibold text-gray-700">Couriers</span>
            <span className="text-xs bg-blue-100 text-blue-700 font-semibold px-2 py-0.5 rounded-full">
              {filteredCouriers.length}
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Agency No.</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Agency Name</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Created</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={4} className="py-12 text-center"><LoadingSpinner size="lg" message="Loading couriers..." /></td></tr>
              ) : filteredCouriers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-gray-400">
                    <Building2 className="w-10 h-10 mx-auto mb-2 text-gray-200" />
                    <p className="text-sm">No couriers found</p>
                    {searchTerm && <p className="text-xs mt-1">Try adjusting your search</p>}
                  </td>
                </tr>
              ) : filteredCouriers.map((courier) => (
                <tr key={courier.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-sm font-semibold text-gray-800">{courier.agency_number}</td>
                  <td className="px-4 py-3 text-sm text-gray-800">{courier.agency_name}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{courier.created_at ? new Date(courier.created_at).toLocaleDateString('en-IN') : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => { setEditingCourier(courier); setCourierFormData({ agency_number: courier.agency_number, agency_name: courier.agency_name }); setShowAddForm(true); }}
                        className="p-1.5 rounded border border-gray-200 text-blue-600 hover:bg-blue-50 hover:border-blue-300 transition-colors"
                        title="Edit"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleCourierDelete(courier.id)}
                        className="p-1.5 rounded border border-gray-200 text-red-500 hover:bg-red-50 hover:border-red-300 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  return (
    <div className="rounded-xl border border-gray-200 shadow-sm bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-blue-600" />
          <h2 className="text-base font-bold text-gray-800">Master Data</h2>
        </div>
        {/* Sub-tab pills */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => { setSearchTerm(''); setShowAddForm(false); setActiveSubTab('parties'); }}
            className={`h-8 px-4 text-sm font-medium rounded-md transition-colors ${
              activeSubTab === 'parties'
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              Parties
            </span>
          </button>
          <button
            onClick={() => { setSearchTerm(''); setShowAddForm(false); setActiveSubTab('couriers'); }}
            className={`h-8 px-4 text-sm font-medium rounded-md transition-colors ${
              activeSubTab === 'couriers'
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" />
              Couriers
            </span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-5">
        {activeSubTab === 'parties' ? renderPartiesTab() : renderCouriersTab()}
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
    </div>
  );
}
