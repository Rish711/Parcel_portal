import React, { useState, useEffect } from 'react';
import { supabase, handleSupabaseError } from '../lib/supabase';
import { emitSyncEvent } from '../lib/realtimeSync';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { Flag, Search, RefreshCw, Package, X, Filter, ArrowLeft, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { formatDate, formatTime } from '../lib/dateUtils';
import toast from 'react-hot-toast';

interface PartyEntry {
  id: string;
  party_code: string;
  party_name: string;
  address: string;
  phone_number?: string;
  bill_numbers: string[];
  boxes: number;
  courier_agency_name: string;
  date: string;
  is_flagged: boolean;
}

interface FlaggedParty {
  party_code: string;
  party_name: string;
  address: string;
  phone_number?: string;
  flagged_at: string;
}

interface CourierAgency {
  id: string;
  agency_name: string;
  agency_number: string;
}

export function FlagPartiesTab() {
  const { dialogState, openConfirmDialog, handleConfirm, handleCancel } = useConfirmDialog();
  const [partyEntries, setPartyEntries] = useState<PartyEntry[]>([]);
  const [courierAgencies, setCourierAgencies] = useState<CourierAgency[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCourier, setSelectedCourier] = useState('');
  const [filteredEntries, setFilteredEntries] = useState<PartyEntry[]>([]);
  const [showFlaggedView, setShowFlaggedView] = useState(false);
  const [flaggedParties, setFlaggedParties] = useState<FlaggedParty[]>([]);
  const [filteredFlaggedParties, setFilteredFlaggedParties] = useState<FlaggedParty[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [partyEntries, searchTerm, selectedCourier]);

  useEffect(() => {
    if (showFlaggedView) {
      fetchFlaggedParties();
    }
  }, [showFlaggedView]);

  useEffect(() => {
    applyFlaggedFilters();
  }, [flaggedParties, searchTerm, selectedCourier]);

  async function loadData() {
    try {
      setLoading(true);
      await Promise.all([
        fetchCourierAgencies(),
        fetchPartyEntries()
      ]);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchCourierAgencies() {
    try {
      const { data, error } = await supabase
        .from('courier_agency_list')
        .select('id, agency_name, agency_number')
        .order('agency_name');
      
      if (error) throw error;
      setCourierAgencies(data || []);
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(`Failed to load courier agencies: ${errorMessage}`);
    }
  }

  async function fetchFlaggedParties() {
    try {
      const { data, error } = await supabase
        .from('flagged_parties')
        .select('*')
        .order('flagged_at', { ascending: false });

      if (error) throw error;
      setFlaggedParties(data || []);
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(`Failed to load flagged parties: ${errorMessage}`);
    }
  }

  async function fetchPartyEntries() {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Fetch party entries
      const { data, error } = await supabase
        .from('party_list')
        .select(`
          *,
          party_info:party_information(*),
          courier_agency:courier_agency_list(*)
        `)
        .gte('date', today.toISOString())
        .lt('date', tomorrow.toISOString())
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch flagged parties
      const { data: flaggedData, error: flaggedError } = await supabase
        .from('flagged_parties')
        .select('party_code');

      if (flaggedError) throw flaggedError;

      const flaggedCodes = new Set((flaggedData || []).map(fp => fp.party_code));

      const processedEntries: PartyEntry[] = (data || []).map(entry => ({
        id: entry.id,
        party_code: entry.party_code,
        party_name: entry.party_info?.party_name || 'Unknown Party',
        address: entry.party_info?.address || 'No address',
        bill_numbers: entry.bill_numbers || [],
        boxes: entry.boxes || 0,
        courier_agency_name: entry.courier_agency?.agency_name || 'Unknown Courier',
        date: entry.date,
        is_flagged: flaggedCodes.has(entry.party_code)
      }));


      setPartyEntries(processedEntries);
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(`Failed to load party entries: ${errorMessage}`);
    }
  }

  function applyFilters() {
    let filtered = [...partyEntries];

    // Apply courier filter
    if (selectedCourier) {
      filtered = filtered.filter(entry => entry.courier_agency_name === selectedCourier);
    }

    // Apply search filter
    if (searchTerm.trim()) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(entry => {
        // Check party name, code, and address
        const basicMatch =
          entry.party_name.toLowerCase().includes(searchLower) ||
          entry.party_code.toLowerCase().includes(searchLower) ||
          entry.address.toLowerCase().includes(searchLower);

        // Check bill numbers (partial match, case-insensitive)
        // Join all bill numbers into a single comma-separated string and check
        const billNumbersString = entry.bill_numbers.join(',').toLowerCase();
        const billMatch = billNumbersString.includes(searchLower);

        return basicMatch || billMatch;
      });
    }

    setFilteredEntries(filtered);
  }

  function applyFlaggedFilters() {
    let filtered = [...flaggedParties];

    // Apply courier filter if selected
    if (selectedCourier) {
      // Get party entries for this courier to filter flagged parties
      const courierPartyEntries = partyEntries.filter(entry =>
        entry.courier_agency_name === selectedCourier
      );
      const courierPartyCodes = new Set(courierPartyEntries.map(entry => entry.party_code));

      filtered = filtered.filter(flagged =>
        courierPartyCodes.has(flagged.party_code)
      );
    }

    // Apply search filter
    if (searchTerm.trim()) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(flagged => {
        // Check party name, code, and address
        const basicMatch =
          flagged.party_name.toLowerCase().includes(searchLower) ||
          flagged.party_code.toLowerCase().includes(searchLower) ||
          flagged.address.toLowerCase().includes(searchLower);

        // Check bill numbers from party entries
        const partyEntry = partyEntries.find(entry => entry.party_code === flagged.party_code);
        if (partyEntry) {
          const billNumbersString = partyEntry.bill_numbers.join(',').toLowerCase();
          const billMatch = billNumbersString.includes(searchLower);
          return basicMatch || billMatch;
        }

        return basicMatch;
      });
    }

    setFilteredFlaggedParties(filtered);
  }

  async function flagParty(partyCode: string, partyName: string, address: string) {
    try {
      // INSERT into flagged_parties with ON CONFLICT DO NOTHING for idempotency
      const { data, error } = await supabase
        .from('flagged_parties')
        .upsert([{
          party_code: partyCode,
          party_name: partyName,
          address: address || 'No address',
          flagged_at: new Date().toISOString()
        }], {
          onConflict: 'party_code',
          ignoreDuplicates: true
        });

      if (error) {
        throw error;
      }

      toast.success(`Party ${partyName} flagged successfully`);
      
      // Refetch data to ensure consistency
      await fetchPartyEntries();
      if (showFlaggedView) {
        await fetchFlaggedParties();
      }
      
      // Emit sync event for real-time updates
      emitSyncEvent('update', 'party_list', partyCode, { flagged: true }, 'flag-parties');
      
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(`Failed to flag party: ${errorMessage}`);
    }
  }

  async function unflagParty(partyCode: string, partyName: string) {
    try {
      // DELETE FROM flagged_parties
      const { error } = await supabase
        .from('flagged_parties')
        .delete()
        .eq('party_code', partyCode);

      if (error) throw error;

      toast.success(`Party ${partyName} unflagged successfully`);
      
      // Refetch data to ensure consistency
      await fetchPartyEntries();
      if (showFlaggedView) {
        await fetchFlaggedParties();
      }
      
      // Emit sync event for real-time updates
      emitSyncEvent('update', 'party_list', partyCode, { flagged: false }, 'flag-parties');
      
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(`Failed to unflag party: ${errorMessage}`);
    }
  }

  async function unflagAllFiltered() {
    if (filteredFlaggedParties.length === 0) {
      toast.error('No flagged parties to unflag');
      return;
    }

    const message = `Are you sure you want to unflag all ${filteredFlaggedParties.length} filtered parties?${
      selectedCourier ? ` (${selectedCourier} only)` : ''
    }${searchTerm ? ` (matching "${searchTerm}")` : ''}`;

    const confirmed = await openConfirmDialog({
      title: 'Unflag Multiple Parties',
      message,
      confirmText: `Unflag ${filteredFlaggedParties.length} Parties`,
      cancelText: 'Cancel',
      variant: 'primary'
    });
    
    if (!confirmed) return;

    toast.loading(`Unflagging ${filteredFlaggedParties.length} parties...`, { id: 'unflag-all' });
    try {
      const partyCodes = filteredFlaggedParties.map(party => party.party_code);
      
      // Bulk delete from flagged_parties
      const { error } = await supabase
        .from('flagged_parties')
        .delete()
        .in('party_code', partyCodes);

      if (error) throw error;

      toast.success(`Successfully unflagged ${partyCodes.length} parties`, { id: 'unflag-all' });
      
      // Refetch data to ensure consistency
      await fetchPartyEntries();
      await fetchFlaggedParties();
      
      // Emit sync events for real-time updates
      partyCodes.forEach(partyCode => {
        emitSyncEvent('update', 'party_list', partyCode, { flagged: false }, 'flag-parties');
      });
      
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(`Failed to unflag parties: ${errorMessage}`, { id: 'unflag-all' });
    }
  }

  const flaggedEntries = filteredEntries.filter(entry => entry.is_flagged);
  const unflaggedEntries = filteredEntries.filter(entry => !entry.is_flagged);

  if (showFlaggedView) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowFlaggedView(false)}
              className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-900 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to All Parties
            </button>
            <div>
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Flag className="w-6 h-6 text-red-600" />
                Flagged Parties ({filteredFlaggedParties.length})
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Manage flagged parties that are blocked from scanning
                {selectedCourier && ` • Filtered by: ${selectedCourier}`}
                {searchTerm && ` • Search: "${searchTerm}"`}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            {filteredFlaggedParties.length > 0 && (
              <button
                onClick={unflagAllFiltered}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 flex items-center gap-2"
              >
                <AlertTriangle className="w-4 h-4" />
                Unflag All ({filteredFlaggedParties.length})
              </button>
            )}
            <button
              onClick={() => {
                fetchFlaggedParties();
                fetchPartyEntries();
              }}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 flex items-center gap-2"
            >
              <RefreshCw className="w-5 h-5" />
              Refresh
            </button>
          </div>
        </div>

        {/* Active Filters Display */}
        {(selectedCourier || searchTerm) && (
          <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-center gap-2 text-sm text-blue-800">
              <Filter className="w-4 h-4" />
              <span>Active filters:</span>
              {selectedCourier && (
                <span className="bg-blue-100 px-2 py-1 rounded">
                  Courier: {selectedCourier}
                </span>
              )}
              {searchTerm && (
                <span className="bg-blue-100 px-2 py-1 rounded">
                  Search: "{searchTerm}"
                </span>
              )}
            </div>
          </div>
        )}

        {/* Flagged Parties Table */}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Party Details
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Address
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Flagged At
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-4 text-center">
                    <LoadingSpinner size="sm" message="Loading flagged parties..." />
                  </td>
                </tr>
              ) : filteredFlaggedParties.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-4 text-center text-gray-500">
                    {selectedCourier && searchTerm
                      ? `No flagged parties found for "${selectedCourier}" matching "${searchTerm}"`
                      : selectedCourier
                      ? `No flagged parties found for "${selectedCourier}"`
                      : searchTerm
                      ? `No flagged parties matching "${searchTerm}"`
                      : 'No data found'
                    }
                  </td>
                </tr>
              ) : (
                filteredFlaggedParties.map((party) => (
                  <tr key={party.party_code} className="hover:bg-gray-50 bg-red-50">
                    <td className="px-6 py-4 text-sm text-gray-900">
                      <div className="flex items-center gap-2">
                        <Flag className="w-4 h-4 text-red-600" />
                        <div>
                          <p className="font-medium text-gray-900">{party.party_name}</p>
                          <p className="text-gray-600">Code: {party.party_code}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      <div>{party.address}</div>
                      {party.phone_number && (
                        <div className="text-gray-600 mt-1">📞 {party.phone_number}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatTime(new Date(party.flagged_at))}
                      <div className="text-xs text-gray-500">
                        {formatDate(new Date(party.flagged_at))}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <button
                        onClick={() => unflagParty(party.party_code, party.party_name)}
                        className="px-3 py-1 rounded text-xs font-medium bg-green-600 text-white hover:bg-green-700"
                      >
                        Unflag
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Instructions */}
        <div className="mt-8 p-4 bg-red-50 rounded-lg border border-red-200">
          <h3 className="text-sm font-medium text-red-900 mb-2">Flagged Parties Management</h3>
          <ul className="text-xs text-red-800 space-y-1">
            <li>• <strong>Flagged parties</strong> are blocked from scanning in the Scan Tally tab</li>
            <li>• <strong>Unflag individual parties</strong> using the "Unflag" button in each row</li>
            <li>• <strong>Bulk unflag</strong> all filtered parties using the "Unflag All" button</li>
            <li>• <strong>Filters apply</strong> to both the main view and this flagged parties view</li>
            <li>• <strong>Real-time updates</strong> ensure all tabs reflect changes immediately</li>
            <li>• <strong>Scanning will be allowed</strong> immediately after unflagging</li>
          </ul>
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

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Flag className="w-6 h-6 text-red-600" />
            Flag Parties
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Flag parties to prevent scanning and require multiple bills in same box
          </p>
        </div>
        <div className="flex items-center space-x-4">
          <button
            onClick={loadData}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 flex items-center gap-2"
          >
            <RefreshCw className="w-5 h-5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Courier Filter */}
      <div className="mb-6 p-4 bg-purple-50 rounded-lg border border-purple-200">
        <div className="flex items-center gap-3 mb-3">
          <Filter className="w-5 h-5 text-purple-600" />
          <h3 className="text-lg font-medium text-purple-900">Filter by Courier Service</h3>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-purple-800 mb-2">
              Select Courier Service:
            </label>
            <select
              value={selectedCourier}
              onChange={(e) => setSelectedCourier(e.target.value)}
              className="w-full px-3 py-2 border border-purple-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
            >
              <option value="">All Courier Services</option>
              {courierAgencies.map((agency) => (
                <option key={agency.id} value={agency.agency_name}>
                  {agency.agency_name} ({agency.agency_number})
                </option>
              ))}
            </select>
          </div>
          
          <div className="text-sm text-purple-700">
            <div><strong>Filtered Results:</strong></div>
            <div>Total: {filteredEntries.length} entries</div>
            <div>Flagged: {flaggedEntries.length} | Unflagged: {unflaggedEntries.length}</div>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg">
        <div className="flex items-center gap-3 mb-3">
          <Search className="w-5 h-5 text-gray-600" />
          <h3 className="text-lg font-medium text-gray-900">Search Within Results</h3>
        </div>
        
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by party name, code, address, or bill numbers..."
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 flex items-center gap-2"
            >
              <X className="w-4 h-4" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
          <div className="text-2xl font-bold text-blue-900">{filteredEntries.length}</div>
          <div className="text-sm text-blue-600">
            {selectedCourier ? `${selectedCourier} Entries` : 'Total Entries'}
          </div>
        </div>
        <div 
          className="bg-red-50 p-4 rounded-lg border border-red-200 cursor-pointer hover:bg-red-100 transition-colors"
          onClick={() => setShowFlaggedView(true)}
        >
          <div className="text-2xl font-bold text-red-900">{flaggedEntries.length}</div>
          <div className="text-sm text-red-600">Flagged Entries (Click to manage)</div>
        </div>
        <div className="bg-green-50 p-4 rounded-lg border border-green-200">
          <div className="text-2xl font-bold text-green-900">{unflaggedEntries.length}</div>
          <div className="text-sm text-green-600">Unflagged Entries</div>
        </div>
      </div>

      {/* Entries Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Time
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Party Details
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Address
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Bills
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Boxes
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Courier
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-6 py-4 text-center">
                  <LoadingSpinner size="sm" message="Loading entries..." />
                </td>
              </tr>
            ) : filteredEntries.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-4 text-center text-gray-500">
                  {selectedCourier && searchTerm
                    ? `No entries found for "${selectedCourier}" matching "${searchTerm}"`
                    : selectedCourier
                    ? `No entries found for "${selectedCourier}"`
                    : searchTerm
                    ? `No entries matching "${searchTerm}"`
                    : 'No data found'
                  }
                </td>
              </tr>
            ) : (
              filteredEntries.map((entry) => (
                <tr key={entry.id} className={`hover:bg-gray-50 ${entry.is_flagged ? 'bg-red-50' : ''}`}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatTime(new Date(entry.date))}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    <div className="flex items-center gap-2">
                      {entry.is_flagged && <Flag className="w-4 h-4 text-red-600" />}
                      <div>
                        <p className="font-medium text-gray-900">{entry.party_name}</p>
                        <p className="text-gray-600">Code: {entry.party_code}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {entry.address}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    <div className="flex flex-wrap gap-1">
                      {entry.bill_numbers.slice(0, 3).map((bill, idx) => (
                        <span
                          key={idx}
                          className="inline-block bg-gray-100 border border-gray-200 px-2 py-1 rounded text-xs"
                        >
                          {bill}
                        </span>
                      ))}
                      {entry.bill_numbers.length > 3 && (
                        <span className="text-xs text-gray-500">
                          +{entry.bill_numbers.length - 3} more
                        </span>
                      )}
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
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      entry.is_flagged 
                        ? 'bg-red-100 text-red-800' 
                        : 'bg-green-100 text-green-800'
                    }`}>
                      {entry.is_flagged ? 'Flagged' : 'Unflagged'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {entry.is_flagged ? (
                      <button
                        onClick={() => unflagParty(entry.party_code, entry.party_name)}
                        className="px-3 py-1 rounded text-xs font-medium bg-green-600 text-white hover:bg-green-700"
                      >
                        Unflag
                      </button>
                    ) : (
                      <button
                        onClick={() => flagParty(entry.party_code, entry.party_name, entry.address)}
                        className="px-3 py-1 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700"
                      >
                        Flag
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Instructions */}
      <div className="mt-8 p-4 bg-blue-50 rounded-lg border border-blue-200">
        <h3 className="text-sm font-medium text-blue-900 mb-2">Flag Parties Instructions</h3>
        <ul className="text-xs text-blue-800 space-y-1">
          <li>• <strong>Filter by Courier:</strong> Select a courier service to view only parties using that courier</li>
          <li>• <strong>Flag:</strong> Click "Flag" button to prevent scanning and show warnings about multiple bills in same box</li>
          <li>• <strong>Unflag:</strong> Click "Unflag" button to allow normal scanning again</li>
          <li>• <strong>Flagged parties</strong> cannot be scanned in the Scan Tally tab</li>
          <li>• <strong>Search</strong> works within filtered results across party names, codes, addresses, and bill numbers (supports partial matches)</li>
          <li>• <strong>Flagged parties</strong> are stored in flagged_parties table for audit purposes</li>
          <li>• <strong>Real-time updates:</strong> Flag changes are immediately reflected across all tabs</li>
        </ul>
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