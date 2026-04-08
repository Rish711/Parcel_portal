import React, { useState, useEffect } from 'react';
import { supabase, handleSupabaseError } from '../lib/supabase';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { Calculator, Download, Printer, Plus, Edit, Trash2, Search, RefreshCw, DollarSign, FileText, Eye } from 'lucide-react';
import { format } from 'date-fns';
import { formatDate } from '../lib/dateUtils';
import { useCompanySettings } from '../hooks/useCompanySettings';
import toast from 'react-hot-toast';

interface CourierAgency {
  id: string;
  agency_name: string;
  agency_number: string;
}

interface CourierBill {
  id: string;
  from_date: string;
  to_date: string;
  transporter_id: string;
  number_of_boxes: number;
  per_box_rate: number;
  total_cost: number;
  created_at: string;
  updated_at: string;
  courier_agency: {
    agency_name: string;
    agency_number: string;
  };
}

interface BillFormData {
  fromDate: string;
  toDate: string;
  transporterId: string;
}

export function CourierBillTab() {
  const { settings: co } = useCompanySettings();
  const { dialogState, openConfirmDialog, handleConfirm, handleCancel } = useConfirmDialog();
  const [courierAgencies, setCourierAgencies] = useState<CourierAgency[]>([]);
  const [filteredAgencies, setFilteredAgencies] = useState<CourierAgency[]>([]);
  const [courierBills, setCourierBills] = useState<CourierBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [editingBill, setEditingBill] = useState<CourierBill | null>(null);
  const [showInvoicePreview, setShowInvoicePreview] = useState(false);
  const [selectedBillForInvoice, setSelectedBillForInvoice] = useState<CourierBill | null>(null);
  const [fetchingBoxes, setFetchingBoxes] = useState(false);
  const [fetchedBoxCount, setFetchedBoxCount] = useState(0);
  const [courierRates, setCourierRates] = useState<{
    id: string;
    courier_agency_id: string;
    rate_per_box: number;
  }[]>([]);
  
  const [formData, setFormData] = useState<BillFormData>({
    fromDate: format(new Date(), 'yyyy-MM-dd'),
    toDate: format(new Date(), 'yyyy-MM-dd'),
    transporterId: ''
  });

  // Pricing constants
  const SOLANKURE_RATE = 27;
  const OTHER_RATE = 10;

  useEffect(() => {
    loadInitialData();
  }, []);

  // Fetch courier rates for accurate pricing
  useEffect(() => {
    fetchCourierRates();
  }, []);

  // Auto-fetch boxes when form data changes
  useEffect(() => {
    if (formData.transporterId && formData.fromDate && formData.toDate) {
      fetchBoxCount();
    } else {
      setFetchedBoxCount(0);
    }
  }, [formData.transporterId, formData.fromDate, formData.toDate]);

  async function loadInitialData() {
    try {
      setLoading(true);
      await Promise.all([
        fetchCourierAgencies(),
        fetchCourierBills()
      ]);
    } catch (error) {
      console.error('Failed to load initial data:', error);
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
      toast.error(`Failed to load transporters: ${errorMessage}`);
    }
  }

  async function fetchCourierBills() {
    try {
      const { data, error } = await supabase
        .from('courier_bills')
        .select(`
          *,
          courier_agency:courier_agency_list(agency_name, agency_number)
        `)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setCourierBills(data || []);
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(`Failed to load courier bills: ${errorMessage}`);
    }
  }

  async function fetchCourierRates() {
    try {
      const { data, error } = await supabase
        .from('courier_rates')
        .select('id, courier_agency_id, rate_per_box');
      
      if (error) throw error;
      setCourierRates(data || []);
    } catch (error) {
      console.error('Error fetching courier rates:', error);
      // Don't show error toast as this is fallback functionality
    }
  }

  async function fetchBoxCount() {
    if (!formData.transporterId || !formData.fromDate || !formData.toDate) {
      setFetchedBoxCount(0);
      return;
    }

    // Validate date range
    if (new Date(formData.fromDate) > new Date(formData.toDate)) {
      toast.error('From date cannot be later than to date');
      setFetchedBoxCount(0);
      return;
    }

    try {
      setFetchingBoxes(true);
      
      const startDate = new Date(formData.fromDate);
      startDate.setHours(0, 0, 0, 0);
      
      const endDate = new Date(formData.toDate);
      endDate.setHours(23, 59, 59, 999);

      // Fetch ALL records without any limits to prevent underbilling
      let allData = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error, count } = await supabase
          .from('party_list')
          .select('boxes', { count: 'exact' })
          .eq('courier_agency_id', formData.transporterId)
          .gte('date', startDate.toISOString())
          .lte('date', endDate.toISOString())
          .range(from, from + batchSize - 1);

        if (error) throw error;

        if (data && data.length > 0) {
          allData = [...allData, ...data];
          from += batchSize;
          
          // Check if we've fetched all records
          hasMore = data.length === batchSize && (count === null || allData.length < count);
        } else {
          hasMore = false;
        }
      }

      const totalBoxes = allData.reduce((sum, entry) => sum + (entry.boxes || 0), 0);
      setFetchedBoxCount(totalBoxes);

    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(`Failed to fetch box count: ${errorMessage}`);
      setFetchedBoxCount(0);
    } finally {
      setFetchingBoxes(false);
    }
  }

  function getPerBoxRate(transporterId: string): number {
    // First try to get rate from courier_rates table
    const rateFromDB = courierRates.find(rate => rate.courier_agency_id === transporterId);
    if (rateFromDB) {
      return rateFromDB.rate_per_box;
    }
    
    // Fallback to legacy logic for backward compatibility
    const agency = courierAgencies.find(a => a.id === transporterId);
    if (!agency) return OTHER_RATE;
    
    const agencyName = agency.agency_name.toLowerCase();
    return (agencyName.includes('solankure') || agencyName.includes('solakanure')) 
      ? SOLANKURE_RATE 
      : OTHER_RATE;
  }

  function calculateTotalCost(): number {
    if (!formData.transporterId || fetchedBoxCount <= 0) return 0;
    const rate = getPerBoxRate(formData.transporterId);
    return fetchedBoxCount * rate;
  }

  function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2
    }).format(amount);
  }

  function generateInvoiceNumber(bill: CourierBill): string {
    const date = new Date(bill.created_at);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const time = String(date.getHours()).padStart(2, '0') + String(date.getMinutes()).padStart(2, '0');
    return `INV-${year}${month}${day}-${time}`;
  }

  function calculateTax(amount: number): number {
    return amount * 0.18; // 18% GST
  }

  function generateInvoiceHTML(bill: CourierBill): string {
    const invoiceNumber = generateInvoiceNumber(bill);
    const invoiceDate = format(new Date(bill.created_at), 'dd/MM/yyyy');
    const subtotal = bill.total_cost;

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Invoice - ${invoiceNumber}</title>
          <style>
            @page {
              size: A4;
              margin: 2cm;
            }
            
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            
            body {
              font-family: 'Arial', sans-serif;
              line-height: 1.6;
              color: #333;
              background: white;
            }
            
            .invoice-container {
              max-width: 800px;
              margin: 0 auto;
              padding: 40px;
              background: white;
            }
            
            .invoice-header {
              display: flex;
              flex-direction: column;
              align-items: center;
              margin-bottom: 40px;
              padding-bottom: 20px;
              border-bottom: 3px solid #2563eb;
            }
            
            .company-info {
              text-align: center;
              margin-bottom: 30px;
            }
            
            .company-info h1 {
              font-size: 28px;
              font-weight: bold;
              color: #1e40af;
              margin-bottom: 8px;
            }
            
            .company-info p {
              color: #6b7280;
              font-size: 14px;
              margin: 2px 0;
            }
            
            .invoice-details {
              text-align: center;
              margin-bottom: 30px;
            }
            
            .invoice-title {
              font-size: 36px;
              font-weight: bold;
              color: #1e40af;
              margin-bottom: 10px;
            }
            
            .invoice-meta {
              font-size: 14px;
              color: #6b7280;
            }
            
            .billing-section {
              display: flex;
              justify-content: space-between;
              margin-bottom: 40px;
            }
            
            .billing-info h3 {
              font-size: 16px;
              font-weight: bold;
              color: #374151;
              margin-bottom: 10px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            
            .customer-name {
              font-size: 18px;
              font-weight: bold;
              color: #1e40af;
              margin-bottom: 5px;
            }
            
            .items-table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 30px;
              box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            }
            
            .items-table th {
              background: #f3f4f6;
              padding: 15px;
              text-align: left;
              font-weight: bold;
              color: #374151;
              border-bottom: 2px solid #e5e7eb;
            }
            
            .items-table td {
              padding: 15px;
              border-bottom: 1px solid #e5e7eb;
            }
            
            .items-table tr:hover {
              background: #f9fafb;
            }
            
            .text-right {
              text-align: right;
            }
            
            .totals-section {
              margin-left: auto;
              width: 300px;
              margin-bottom: 40px;
            }
            
            .totals-table {
              width: 100%;
              border-collapse: collapse;
            }
            
            .totals-table td {
              padding: 10px 15px;
              border-bottom: 1px solid #e5e7eb;
            }
            
            .totals-table .total-row {
              background: #1e40af;
              color: white;
              font-weight: bold;
              font-size: 18px;
            }
            
            .footer {
              text-align: center;
              padding-top: 20px;
              border-top: 1px solid #e5e7eb;
              color: #6b7280;
              font-size: 12px;
            }
            
            .highlight {
              background: #fef3c7;
              padding: 2px 6px;
              border-radius: 4px;
            }
            
            @media print {
              body { -webkit-print-color-adjust: exact; }
              .invoice-container { padding: 20px; }
            }
          </style>
        </head>
        <body>
          <div class="invoice-container">
            <!-- Header -->
            <div class="invoice-header">
              <div class="company-info">
                <h1>${co.company_name.toUpperCase()}</h1>
                <p>${co.address}</p>
                <p>Phone: ${co.parcel_dept_phone}</p>
                <p>Email: ${co.email}</p>
              </div>
            </div>
            
            <div class="invoice-details">
              <div class="invoice-title">INVOICE</div>
              <div class="invoice-meta">
                <p><strong>Invoice #:</strong> ${invoiceNumber}</p>
                <p><strong>Date:</strong> ${invoiceDate}</p>
              </div>
            </div>
            
            <!-- Billing Information -->
            <div class="billing-section">
              <div class="billing-info">
                <h3>Bill To:</h3>
                <div class="customer-name">${bill.courier_agency?.agency_name || 'Unknown'}</div>
                <p>Agency Number: ${bill.courier_agency?.agency_number || 'N/A'}</p>
                <p>Service Period: ${format(new Date(bill.from_date), 'dd/MM/yyyy')} – ${format(new Date(bill.to_date), 'dd/MM/yyyy')}</p>
              </div>
              <div class="billing-info">
                <h3>From:</h3>
                <div class="customer-name">${co.company_name.toUpperCase()}</div>
                <p>Department: Parcel Department</p>
                <p>Location: ${co.address}</p>
              </div>
            </div>
            
            <!-- Items Table -->
            <table class="items-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th class="text-right">Quantity</th>
                  <th class="text-right">Unit Price</th>
                  <th class="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>Courier Service - Box Transportation</strong><br>
                    <small>Service Period: ${format(new Date(bill.from_date), 'dd MMM yyyy')} to ${format(new Date(bill.to_date), 'dd MMM yyyy')}</small><br>
                    <small class="highlight">Rate: ${bill.courier_agency?.agency_name || 'Standard'} Special Rate</small>
                  </td>
                  <td class="text-right">${bill.number_of_boxes.toLocaleString('en-IN')} boxes</td>
                  <td class="text-right">${formatCurrency(bill.per_box_rate)}</td>
                  <td class="text-right">${formatCurrency(bill.total_cost)}</td>
                </tr>
              </tbody>
            </table>
            
            <!-- Totals -->
            <div class="totals-section">
              <table class="totals-table">
                <tr class="total-row">
                  <td><strong>SUBTOTAL:</strong></td>
                  <td class="text-right"><strong>${formatCurrency(subtotal)}</strong></td>
                </tr>
              </table>
            </div>
            
            <!-- Footer -->
            <div class="footer">
              <p>This is a computer-generated invoice and does not require a signature.</p>
              <p>Generated on ${format(new Date(), 'dd/MM/yyyy HH:mm:ss')}</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  function viewInvoice(bill: CourierBill) {
    setSelectedBillForInvoice(bill);
    setShowInvoicePreview(true);
  }

  function printInvoice(bill: CourierBill) {
    try {
      const printWindow = window.open('', '_blank', 'width=800,height=600');
      if (!printWindow) {
        toast.error('Please allow popups to print invoice');
        return;
      }

      printWindow.document.write(generateInvoiceHTML(bill));
      printWindow.document.close();
      
      printWindow.onload = function() {
        setTimeout(() => {
          printWindow.focus();
          printWindow.print();
          
          setTimeout(() => {
            printWindow.close();
          }, 1000);
          
          toast.success(`Invoice for ${bill.courier_agency?.agency_name} printed successfully!`);
        }, 500);
      };
      
    } catch (error) {
      console.error('Print error:', error);
      toast.error('Failed to print invoice. Please try again.');
    }
  }
  function handleInputChange(field: keyof BillFormData, value: string | number) {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  }


  function validateForm(): boolean {
    if (!formData.fromDate) {
      toast.error('Please select a from date');
      return false;
    }
    
    if (!formData.toDate) {
      toast.error('Please select a to date');
      return false;
    }
    
    if (new Date(formData.fromDate) > new Date(formData.toDate)) {
      toast.error('From date cannot be later than to date');
      return false;
    }
    
    if (!formData.transporterId) {
      toast.error('Please select a transporter');
      return false;
    }
    
    if (fetchedBoxCount <= 0) {
      toast.error('No boxes found for the selected criteria');
      return false;
    }
    
    return true;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    if (!validateForm()) return;
    
    setSubmitting(true);
    
    try {
      const perBoxRate = getPerBoxRate(formData.transporterId);
      const totalCost = fetchedBoxCount * perBoxRate;
      
      if (editingBill) {
        const { error } = await supabase
          .from('courier_bills')
          .update({
            from_date: formData.fromDate,
            to_date: formData.toDate,
            transporter_id: formData.transporterId,
            number_of_boxes: fetchedBoxCount,
            per_box_rate: perBoxRate,
            total_cost: totalCost
          })
          .eq('id', editingBill.id);
        
        if (error) throw error;
        toast.success('Courier bill updated successfully');
        setEditingBill(null);
      } else {
        const { error } = await supabase
          .from('courier_bills')
          .insert([{
            from_date: formData.fromDate,
            to_date: formData.toDate,
            transporter_id: formData.transporterId,
            number_of_boxes: fetchedBoxCount,
            per_box_rate: perBoxRate,
            total_cost: totalCost
          }]);
        
        if (error) throw error;
        toast.success('Courier bill created successfully');
      }
      
      // Reset form
      setFormData({
        fromDate: format(new Date(), 'yyyy-MM-dd'),
        toDate: format(new Date(), 'yyyy-MM-dd'),
        transporterId: ''
      });
      setFetchedBoxCount(0);
      
      // Refresh bills list
      await fetchCourierBills();
      
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(`Failed to save courier bill: ${errorMessage}`);
    } finally {
      setSubmitting(false);
    }
  }

  function handleEdit(bill: CourierBill) {
    setFormData({
      fromDate: bill.from_date,
      toDate: bill.to_date,
      transporterId: bill.transporter_id
    });
    setEditingBill(bill);
  }

  function handleCancelEdit() {
    setEditingBill(null);
    setFormData({
      fromDate: format(new Date(), 'yyyy-MM-dd'),
      toDate: format(new Date(), 'yyyy-MM-dd'),
      transporterId: ''
    });
    setFetchedBoxCount(0);
  }

  async function handleDelete(billId: string) {
    const confirmed = await openConfirmDialog({
      title: 'Delete Courier Bill',
      message: 'Are you sure you want to delete this courier bill? This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger'
    });
    
    if (!confirmed) return;

    toast.loading('Deleting courier bill...', { id: 'delete-bill' });
    try {
      const { error } = await supabase
        .from('courier_bills')
        .delete()
        .eq('id', billId);

      if (error) throw error;
      toast.success('Courier bill deleted successfully', { id: 'delete-bill' });
      await fetchCourierBills();
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(`Failed to delete courier bill: ${errorMessage}`, { id: 'delete-bill' });
    }
  }

  function clearForm() {
    setFormData({
      fromDate: format(new Date(), 'yyyy-MM-dd'),
      toDate: format(new Date(), 'yyyy-MM-dd'),
      transporterId: ''
    });
    setEditingBill(null);
    setFetchedBoxCount(0);
    toast.success('Form cleared');
  }

  async function handleRefresh() {
    try {
      await loadInitialData();
      toast.success('Data refreshed successfully');
    } catch (error) {
      toast.error('Failed to refresh data');
    }
  }

  function downloadBillsData() {
    const csv = [
      ['S.No', 'From Date', 'To Date', 'Transporter', 'Boxes', 'Rate per Box', 'Total Cost', 'Created At'],
      ...courierBills.map((bill, index) => [
        index + 1,
        format(new Date(bill.from_date), 'dd/MM/yyyy'),
        format(new Date(bill.to_date), 'dd/MM/yyyy'),
        bill.courier_agency?.agency_name || 'Unknown',
        bill.number_of_boxes,
        `₹${bill.per_box_rate}`,
        `₹${bill.total_cost}`,
        format(new Date(bill.created_at), 'dd/MM/yyyy HH:mm')
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `courier_bills_${formatDate(new Date())}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  function handlePrint() {
    window.print();
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <LoadingSpinner size="lg" message="Loading courier bill data..." />
      </div>
    );
  }

  const totalCost = calculateTotalCost();
  const selectedAgency = courierAgencies.find(a => a.id === formData.transporterId);
  const perBoxRate = formData.transporterId ? getPerBoxRate(formData.transporterId) : 0;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Calculator className="w-6 h-6 text-blue-600" />
            Courier Bill Generation
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Generate bills with per-box pricing (Solankure: ₹27, Others: ₹10)
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleRefresh}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button
            onClick={downloadBillsData}
            disabled={courierBills.length === 0}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50"
          >
            <Download className="w-5 h-5" />
          </button>
          <button
            onClick={handlePrint}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            <Printer className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Bill Generation Form */}
      <div className="mb-8 p-6 bg-blue-50 rounded-lg border border-blue-200">
        <h3 className="text-lg font-medium text-blue-900 mb-4 flex items-center gap-2">
          <DollarSign className="w-5 h-5" />
          {editingBill ? 'Edit Courier Bill' : 'Generate New Courier Bill'}
        </h3>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                From Date *
              </label>
              <input
                type="date"
                required
                value={formData.fromDate}
                onChange={(e) => handleInputChange('fromDate', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                To Date *
              </label>
              <input
                type="date"
                required
                value={formData.toDate}
                onChange={(e) => handleInputChange('toDate', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Transporter *
            </label>
            <select
              required
              value={formData.transporterId}
              onChange={(e) => handleInputChange('transporterId', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Select Transporter</option>
              {courierAgencies.map((agency) => (
                <option key={agency.id} value={agency.id}>
                  {agency.agency_name} ({agency.agency_number})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fetched Box Count
              </label>
              <div className="w-full px-3 py-2 bg-gray-100 border border-gray-300 rounded-md text-gray-700 flex items-center">
                {fetchingBoxes ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-2"></div>
                    Fetching...
                  </>
                ) : (
                  <>
                    {fetchedBoxCount} boxes
                    {fetchedBoxCount === 0 && formData.transporterId && formData.fromDate && formData.toDate && (
                      <span className="text-orange-600 text-sm ml-2">(No data found)</span>
                    )}
                  </>
                )}
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Rate per Box
              </label>
              <div className="w-full px-3 py-2 bg-gray-100 border border-gray-300 rounded-md text-gray-700">
                {formatCurrency(perBoxRate)}
                {selectedAgency && (
                  <span className="text-xs text-gray-500 ml-2">
                    ({selectedAgency.agency_name.toLowerCase().includes('solankure') || 
                      selectedAgency.agency_name.toLowerCase().includes('solakanure') ? 'Solankure Rate' : 'Standard Rate'})
                  </span>
                )}
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Total Cost
              </label>
              <div className="w-full px-3 py-2 bg-green-50 border border-green-300 rounded-md text-green-800 font-semibold">
                {formatCurrency(totalCost)}
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={clearForm}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Clear Form
            </button>
            {editingBill && (
              <button
                type="button"
                onClick={handleCancelEdit}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel Edit
              </button>
            )}
            <button
              type="submit"
              disabled={submitting || totalCost <= 0 || fetchingBoxes}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  {editingBill ? 'Updating...' : 'Saving...'}
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  {editingBill ? 'Update Bill' : 'Generate Bill'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Bills List */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium">Generated Courier Bills ({courierBills.length})</h3>
        </div>

        {courierBills.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg">
            <Calculator className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Courier Bills Generated</h3>
            <p className="text-gray-600">Create your first courier bill using the form above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    S.No
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date Range
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Transporter
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Boxes
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Rate/Box
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total Cost
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {courierBills.map((bill, index) => (
                  <tr key={bill.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">
                      {index + 1}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      <div>
                        <div>{format(new Date(bill.from_date), 'dd/MM/yyyy')}</div>
                        <div className="text-xs text-gray-500">to {format(new Date(bill.to_date), 'dd/MM/yyyy')}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      <div>
                        <div className="font-medium">{bill.courier_agency?.agency_name || 'Unknown'}</div>
                        <div className="text-xs text-gray-500">{bill.courier_agency?.agency_number}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {bill.number_of_boxes}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatCurrency(bill.per_box_rate)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-green-600">
                      {formatCurrency(bill.total_cost)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {format(new Date(bill.created_at), 'dd/MM/yyyy HH:mm')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div className="flex space-x-2">
                        <button
                          onClick={() => viewInvoice(bill)}
                          className="text-green-600 hover:text-green-900"
                          title="View Invoice"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => printInvoice(bill)}
                          className="text-purple-600 hover:text-purple-900"
                          title="Print Invoice"
                        >
                          <FileText className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleEdit(bill)}
                          className="text-blue-600 hover:text-blue-900"
                          title="Edit Bill"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(bill.id)}
                          className="text-red-600 hover:text-red-900"
                          title="Delete Bill"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

      {/* Invoice Preview Modal */}
      {showInvoicePreview && selectedBillForInvoice && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-auto">
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Invoice Preview - {selectedBillForInvoice.courier_agency?.agency_name}
              </h3>
              <button
                onClick={() => {
                  setShowInvoicePreview(false);
                  setSelectedBillForInvoice(null);
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            
            <div className="p-6">
              <div 
                className="border border-gray-300 bg-white"
                style={{ transform: 'scale(0.8)', transformOrigin: 'top center' }}
                dangerouslySetInnerHTML={{ 
                  __html: generateInvoiceHTML(selectedBillForInvoice).replace('<!DOCTYPE html>', '').replace(/<html[^>]*>/, '').replace('</html>', '').replace(/<head[^>]*>[\s\S]*?<\/head>/, '').replace(/<body[^>]*>/, '').replace('</body>', '')
                }}
              />
            </div>
            
            <div className="flex justify-end space-x-3 p-4 border-t">
              <button
                onClick={() => {
                  setShowInvoicePreview(false);
                  setSelectedBillForInvoice(null);
                }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Close
              </button>
              <button
                onClick={() => {
                  printInvoice(selectedBillForInvoice);
                  setShowInvoicePreview(false);
                  setSelectedBillForInvoice(null);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2"
              >
                <Printer className="w-4 h-4" />
                Print Invoice
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary Statistics */}
      {courierBills.length > 0 && (
        <div className="mt-8 p-4 bg-gray-50 rounded-lg">
          <h3 className="text-sm font-medium text-gray-900 mb-3">Summary Statistics</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {courierBills.length}
              </div>
              <div className="text-sm text-gray-600">Total Bills</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {courierBills.reduce((sum, bill) => sum + bill.number_of_boxes, 0)}
              </div>
              <div className="text-sm text-gray-600">Total Boxes</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">
                {formatCurrency(courierBills.reduce((sum, bill) => sum + bill.total_cost, 0))}
              </div>
              <div className="text-sm text-gray-600">Total Courier Payment</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
