import React, { useState, useEffect, useCallback } from 'react';
import { supabase, handleSupabaseError } from '../lib/supabase';
import { Search, X, RefreshCw, DollarSign, Edit3 } from 'lucide-react';
import { formatDateTime } from '../lib/dateUtils';
import toast from 'react-hot-toast';
import { EditDialog } from './ui/EditDialog';

interface CourierAgency {
  id: string;
  agency_name: string;
  agency_number: string;
  created_at: string;
}

interface CourierRate {
  id: string;
  courier_agency_id: string;
  rate_per_box: number;
  created_at: string;
  updated_at: string;
}

interface CourierWithRate extends CourierAgency {
  rate_per_box: number;
  rate_id?: string;
  rate_updated_at?: string;
}

const DEFAULT_RATE = 10.00;
const DEBOUNCE_DELAY = 300;

export function CourierRateSettings() {
  const [courierAgencies, setCourierAgencies] = useState<CourierAgency[]>([]);
  const [courierRates, setCourierRates] = useState<CourierRate[]>([]);
  const [couriersWithRates, setCouriersWithRates] = useState<CourierWithRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredCouriers, setFilteredCouriers] = useState<CourierWithRate[]>([]);
  const [editingInTable, setEditingInTable] = useState<string | null>(null);
  const [tableEditValue, setTableEditValue] = useState<string>('');
  const [savingRates, setSavingRates] = useState<Set<string>>(new Set());
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);
  const editingCourier = editingInTable
    ? couriersWithRates.find(courier => courier.id === editingInTable) || null
    : null;

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [couriersWithRates, searchTerm]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }
    };
  }, [searchTimeout]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      await Promise.all([
        fetchCourierAgencies(),
        fetchCourierRates()
      ]);
    } catch (error) {
      console.error('Failed to load initial data:', error);
      toast.error('Failed to load courier rate data');
    } finally {
      setLoading(false);
    }
  };

  const fetchCourierAgencies = async () => {
    try {
      const { data, error } = await supabase
        .from('courier_agency_list')
        .select('*')
        .order('agency_name');
      
      if (error) throw error;
      setCourierAgencies(data || []);
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(`Failed to load courier agencies: ${errorMessage}`);
      throw error;
    }
  };

  const fetchCourierRates = async () => {
    try {
      const { data, error } = await supabase
        .from('courier_rates')
        .select('*')
        .order('updated_at', { ascending: false });
      
      if (error) throw error;
      setCourierRates(data || []);
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(`Failed to load courier rates: ${errorMessage}`);
      throw error;
    }
  };

  // Combine courier agencies with their rates
  useEffect(() => {
    const combined = courierAgencies.map(agency => {
      const rate = courierRates.find(r => r.courier_agency_id === agency.id);
      
      return {
        ...agency,
        rate_per_box: rate?.rate_per_box ?? DEFAULT_RATE,
        rate_id: rate?.id,
        rate_updated_at: rate?.updated_at
      };
    });
    
    setCouriersWithRates(combined);
  }, [courierAgencies, courierRates]);

  const applyFilters = useCallback(() => {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    const timeout = setTimeout(() => {
      let filtered = [...couriersWithRates];

      if (searchTerm.trim()) {
        const searchLower = searchTerm.toLowerCase();
        filtered = filtered.filter(courier => 
          courier.agency_name.toLowerCase().includes(searchLower) ||
          courier.agency_number.toLowerCase().includes(searchLower)
        );
      }

      // Sort by agency name
      filtered.sort((a, b) => a.agency_name.localeCompare(b.agency_name));
      
      setFilteredCouriers(filtered);
    }, DEBOUNCE_DELAY);

    setSearchTimeout(timeout);
  }, [couriersWithRates, searchTerm, searchTimeout]);

  const parseRateValue = (value: string): { isValid: boolean; numericValue: number; error?: string } => {
    // Strip currency symbols, commas, and spaces
    const cleanValue = value.replace(/[Rs. ,\s]/g, '').trim();
    
    if (!cleanValue) {
      return { isValid: false, numericValue: 0, error: 'Rate cannot be empty' };
    }

    const numericValue = parseFloat(cleanValue);
    
    if (isNaN(numericValue)) {
      return { isValid: false, numericValue: 0, error: 'Rate must be a valid number' };
    }

    if (numericValue < 0) {
      return { isValid: false, numericValue: 0, error: 'Rate cannot be negative' };
    }

    if (numericValue > 9999) {
      return { isValid: false, numericValue: 0, error: 'Rate cannot exceed Rs. 9999' };
    }

    return { isValid: true, numericValue };
  };

  const updateCourierRate = async (courierId: string, newRate: number): Promise<CourierRate> => {
    try {
      console.log(`Updating rate for courier ${courierId} to Rs. ${newRate}`);
      
      // Use upsert to handle both create and update cases
      const { data, error } = await supabase
        .from('courier_rates')
        .upsert(
          {
            courier_agency_id: courierId,
            rate_per_box: newRate,
            updated_at: new Date().toISOString()
          },
          { 
            onConflict: 'courier_agency_id',
            ignoreDuplicates: false
          }
        )
        .select()
        .single();
      
      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      if (!data) {
        throw new Error('No data returned from upsert operation');
      }

      console.log('Successfully updated rate:', data);
      return data;
    } catch (error) {
      console.error('Error in updateCourierRate:', error);
      throw error;
    }
  };

  const handleRateUpdate = async (courierId: string, newRateValue: string) => {
    const courier = couriersWithRates.find(c => c.id === courierId);
    if (!courier) {
      toast.error('Courier not found');
      return false;
    }

    const validation = parseRateValue(newRateValue);
    
    if (!validation.isValid) {
      toast.error(validation.error || 'Invalid rate value');
      return false;
    }

    // Check if value actually changed
    if (validation.numericValue === courier.rate_per_box) {
      console.log('Rate unchanged, skipping save');
      return true; // No change needed
    }

    // Add to saving set
    setSavingRates(prev => new Set(prev.add(courierId)));

    try {
      console.log(`Saving rate for ${courier.agency_name}: Rs. ${validation.numericValue}`);
      
      const updatedRate = await updateCourierRate(courierId, validation.numericValue);
      
      // Update local state with server response
      setCourierRates(prev => {
        const existing = prev.find(r => r.courier_agency_id === courierId);
        if (existing) {
          // Update existing rate
          return prev.map(r => 
            r.courier_agency_id === courierId 
              ? { ...r, rate_per_box: updatedRate.rate_per_box, updated_at: updatedRate.updated_at }
              : r
          );
        } else {
          // Add new rate
          return [...prev, updatedRate];
        }
      });
      
      toast.success(`Rate updated for ${courier.agency_name}: Rs. ${validation.numericValue.toFixed(2)}`);
      return true;
      
    } catch (error) {
      console.error('Failed to update courier rate:', error);
      const errorMessage = handleSupabaseError(error);
      toast.error(`Failed to update rate: ${errorMessage}`);
      return false;
    } finally {
      // Remove from saving set
      setSavingRates(prev => {
        const newSet = new Set(prev);
        newSet.delete(courierId);
        return newSet;
      });
    }
  };

  const handleTableEdit = (courier: CourierWithRate) => {
    setEditingInTable(courier.id);
    setTableEditValue(courier.rate_per_box.toFixed(2));
  };

  const handleTableSave = async (courierId: string) => {
    const success = await handleRateUpdate(courierId, tableEditValue);
    
    if (success) {
      setEditingInTable(null);
      setTableEditValue('');
    }
  };

  const handleTableCancel = () => {
    setEditingInTable(null);
    setTableEditValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent, courierId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleTableSave(courierId);
    } else if (e.key === 'Escape') {
      handleTableCancel();
    }
  };

  const handleRefresh = async () => {
    try {
      await loadInitialData();
      toast.success('Courier rates refreshed successfully');
    } catch (error) {
      toast.error('Failed to refresh data');
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading courier rate settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <DollarSign className="w-6 h-6 text-green-600" />
            Courier Rate Settings
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Manage per-box rates for courier services â€¢ Default rate: Rs. {DEFAULT_RATE.toFixed(2)}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleRefresh}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 flex items-center gap-2"
          >
            <RefreshCw className="w-5 h-5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <div className="flex items-center gap-3 mb-3">
          <Search className="w-5 h-5 text-gray-600" />
          <h3 className="text-lg font-medium text-gray-900">Search Courier Services</h3>
        </div>
        
        <div className="relative">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by agency name or number..."
            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        
        <p className="text-sm text-gray-600 mt-2">
          Showing {filteredCouriers.length} of {couriersWithRates.length} courier services
        </p>
      </div>

      {/* Rates Table */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium">All Courier Rates</h3>
          <div className="text-sm text-gray-600">
            Click any rate to edit in popup â€¢ {filteredCouriers.length} couriers shown
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  S.No
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Agency Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Agency Number
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Rate per Box
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Updated
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredCouriers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                    {searchTerm ? `No couriers found matching "${searchTerm}"` : 'No courier agencies found'}
                  </td>
                </tr>
              ) : (
                filteredCouriers.map((courier, index) => {
                  const isSaving = savingRates.has(courier.id);
                  
                  return (
                    <tr 
                      key={courier.id} 
                      className={`hover:bg-gray-50 ${isSaving ? 'bg-yellow-50' : ''}`}
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">
                        {index + 1}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        <div className="flex items-center gap-2">
                          {isSaving && (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-yellow-500" title="Saving..." />
                          )}
                          <span className="font-medium">{courier.agency_name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {courier.agency_number}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <button
                          onClick={() => handleTableEdit(courier)}
                          disabled={isSaving}
                          className="text-green-600 hover:text-green-800 font-semibold disabled:opacity-50"
                        >
                          Rs. {courier.rate_per_box.toFixed(2)}
                        </button>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {courier.rate_updated_at ? (
                          <div>
                            <div>{formatDateTime(new Date(courier.rate_updated_at))}</div>
                          </div>
                        ) : (
                          <span className="text-gray-400">Default rate</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <button
                          onClick={() => handleTableEdit(courier)}
                          disabled={isSaving}
                          className="text-blue-600 hover:text-blue-900 disabled:opacity-50"
                          title="Edit Rate"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Instructions */}
      <div className="mt-8 p-4 bg-gray-50 rounded-lg">
        <h3 className="text-sm font-medium text-gray-900 mb-2">Courier Rate Management</h3>
        <ul className="text-xs text-gray-600 space-y-1">
          <li>â€¢ <strong>Search:</strong> Filter couriers by agency name or number (300ms debounce)</li>
          <li>â€¢ <strong>Popup Editing:</strong> Click any rate in the table to edit in a popup</li>
          <li>â€¢ <strong>Save:</strong> Changes save when you confirm the popup</li>
          <li>â€¢ <strong>Validation:</strong> Rates must be numeric, â‰¥ Rs. 0.00, â‰¤ Rs. 9999.00</li>
          <li>â€¢ <strong>Default Rate:</strong> Rs. {DEFAULT_RATE.toFixed(2)} applies to couriers without custom rates</li>
          <li>â€¢ <strong>Real-time Updates:</strong> Changes reflect immediately across all tabs</li>
          <li>â€¢ <strong>Error Handling:</strong> Failed saves show detailed error messages</li>
          <li>â€¢ <strong>Keyboard Shortcuts:</strong> Enter to save, Escape to cancel editing</li>
        </ul>
      </div>

      <EditDialog
        open={!!editingCourier}
        title={`Edit Courier Rate${editingCourier ? ` - ${editingCourier.agency_name}` : ''}`}
        onClose={handleTableCancel}
        footer={
          <>
            <button
              type="button"
              onClick={handleTableCancel}
              className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => editingCourier && handleTableSave(editingCourier.id)}
              disabled={!!editingCourier && savingRates.has(editingCourier.id)}
              className="px-4 py-2 text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              Save Changes
            </button>
          </>
        }
      >
        {editingCourier && (
          <div className="space-y-4">
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-800">
              <div className="font-semibold">{editingCourier.agency_name}</div>
              <div>Agency Number: {editingCourier.agency_number}</div>
              <div>Current Rate: Rs. {editingCourier.rate_per_box.toFixed(2)}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Rate per Box
              </label>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Rs. </span>
                <input
                  type="number"
                  min="0"
                  max="9999"
                  step="1"
                  value={tableEditValue}
                  onChange={(e) => setTableEditValue(e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, editingCourier.id)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                  disabled={savingRates.has(editingCourier.id)}
                />
              </div>
            </div>
          </div>
        )}
      </EditDialog>
    </div>
  );
}




