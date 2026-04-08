import React, { useState, useEffect } from 'react';
import { supabase, handleSupabaseError } from '../lib/supabase';
import {
  getTodaysLabelPrints,
  getLabelPrintsByPartyIds,
  batchCreateLabelPrintRecords,
  LabelPrintRecord,
  determineLabelType,
  markLabelAsPrinted,
  markLabelsAsPrinted,
  getBoxQRCodes,
  getOrGenerateBoxQRCodes,
  regenerateBoxQRCodes,
  BoxQRCode
} from '../lib/labelPersistence';
import { useRealtimeSync, emitSyncEvent, performanceMonitor } from '../lib/realtimeSync';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { EditDialog } from './ui/EditDialog';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { Printer, Package, Download, Search, X, Eye, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { formatDate } from '../lib/dateUtils';
import toast from 'react-hot-toast';
import QRCode from 'qrcode';
import { useCompanySettings } from '../hooks/useCompanySettings';

interface PartyListEntry {
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

interface LabelData {
  id: string;
  partyName: string;
  address: string;
  phoneNumber?: string;
  boxes: number;
  transport: string;
  qrCode: string;
  qrCodeDataUrl: string;
  partyCode: string;
  billNumbers: string[];
  courier_agency_id?: string;
  box_qr_codes?: string[];
}

type FilterType = 'couriers' | 'byhand';

export function LabelPrintTab() {
  const { settings: co } = useCompanySettings();
  const [todayEntries, setTodayEntries] = useState<PartyListEntry[]>([]);
  const [labels, setLabels] = useState<LabelData[]>([]);
  const [persistedLabels, setPersistedLabels] = useState<LabelPrintRecord[]>([]);
  const [filteredLabels, setFilteredLabels] = useState<LabelData[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingQR, setGeneratingQR] = useState(false);
  const [isPrintingAll, setIsPrintingAll] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isPrintingLabel, setIsPrintingLabel] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<FilterType>('couriers');
  const [previewLabel, setPreviewLabel] = useState<LabelData | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedCourierId, setSelectedCourierId] = useState('');
  const [courierAgencies, setCourierAgencies] = useState<any[]>([]);
  const [editingBoxesId, setEditingBoxesId] = useState<string | null>(null);
  const [editingBoxesValue, setEditingBoxesValue] = useState<number>(0);
  const [todayEntriesCount, setTodayEntriesCount] = useState<number>(0);

  const { dialogState, openConfirmDialog, handleConfirm, handleCancel } = useConfirmDialog();

  // Calculate courier counts from current persisted labels
  const calculateCourierCounts = () => {
    const counts: Record<string, number> = {};
    
    persistedLabels.forEach(record => {
      const courierId = record.courier_agency_id;
      if (courierId) {
        counts[courierId] = (counts[courierId] || 0) + 1;
      }
    });
    
    return counts;
  };

  const courierCounts = calculateCourierCounts();
  const editingBoxesLabel = editingBoxesId
    ? labels.find(label => label.id === editingBoxesId) || null
    : null;

  // This is an added helper function, required for realtime sync to work reliably now
  const removeSinglePartyLabel = (partyListId: string) => {
    setLabels(prev => prev.filter(p => p.id !== partyListId));
    setPersistedLabels(prev => prev.filter(p => p.party_list_id !== partyListId));
    setTodayEntries(prev => prev.filter(p => p.id !== partyListId));
    refreshTodayEntriesCount();
  };

  useRealtimeSync(
    ['party_list', 'label_print'],
    async (event) => {
      try {
        if (event.source === 'history' && event.type === 'update') {
          console.log('[LabelPrint] Processing History edit for party:', event.entityId);
          await updateSinglePartyLabel(event.entityId, event.data);
        } else if (event.source === 'party-list' && event.type === 'update') {
          console.log('[LabelPrint] Processing PartyList update for party:', event.entityId);
          await updateSinglePartyLabel(event.entityId, event.data);
        } else if (event.source === 'party-list' && event.type === 'create') {
          console.log('[LabelPrint] Processing PartyList create for party:', event.entityId);
          // The most reliable way to sync a new entry is to reload the data.
          await loadTodayData();
          await refreshTodayEntriesCount();
        } else if (event.source === 'party-list' && event.type === 'delete') {
          console.log('[LabelPrint] Processing PartyList delete for party:', event.entityId);
          removeSinglePartyLabel(event.entityId);
        } else if (event.source === 'scan-tally' && event.type === 'update') {
          console.log('[LabelPrint] Processing ScanTally update for party:', event.entityId);
          // No direct UI update needed here, as scan tally updates its own UI
          // But we might need to re-fetch if label_prints status changes
          // For now, just log
        }
      } catch (error) {
        toast.error(`Failed to sync party update: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    },
    [],
    'LabelPrintTab'
  );

  useEffect(() => {
    // Load data only on initial mount
    loadTodayData();
    loadCourierAgencies();
  }, []);

  useEffect(() => {
    // Only generate labels from persisted data when we have it.
    if (persistedLabels.length > 0) {
      generateLabelsFromPersisted();
    } else {
      setLabels([]);
    }
  }, [persistedLabels]);

  // Apply filters and search
  useEffect(() => {
    applyFiltersAndSearch();
  }, [labels, filterType, searchTerm, selectedCourierId]);

  // Search functionality with debounce
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      applyFiltersAndSearch();
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchTerm]);

  async function loadCourierAgencies() {
    try {
      const { data, error } = await supabase
        .from('courier_agency_list')
        .select('id, agency_name, agency_number')
        .order('agency_name');

      if (error) throw error;
      setCourierAgencies(data || []);
    } catch (error) {
      console.error('Error loading courier agencies:', error);
    }
  }

  async function refreshTodayEntriesCount() {
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
      setTodayEntriesCount(count || 0);
    } catch (error) {
      console.error('Error refreshing today entries count:', error);
    }
  }

  function getCourierParcelCounts() {
    const counts: Record<string, number> = {};
    
    labels.forEach(label => {
      if (label.courier_agency_id) {
        counts[label.courier_agency_id] = (counts[label.courier_agency_id] || 0) + 1;
      }
    });
    
    return counts;
  }

  function buildDisplayLabels(
    records: LabelPrintRecord[],
    boxQRMap: Record<string, string[]> = {}
  ): LabelData[] {
    return records.map((labelRecord) => ({
      id: labelRecord.party_list_id,
      partyName: labelRecord.party_name,
      address: labelRecord.address,
      phoneNumber: labelRecord.phone_number || undefined,
      boxes: labelRecord.boxes,
      transport: labelRecord.transport || 'Unknown Transport',
      qrCode: labelRecord.qr_code,
      qrCodeDataUrl: '',
      partyCode: labelRecord.party_code,
      billNumbers: labelRecord.bill_numbers || [],
      courier_agency_id: labelRecord.courier_agency_id || undefined,
      box_qr_codes: boxQRMap[labelRecord.id] || []
    }));
  }

  // *** START OF BUG FIX ***
  // The logic inside this function has been updated to use the more reliable
  // `getLabelPrintsByPartyIds` function, which prevents the 409 Conflict error.

  async function loadTodayData() {
    try {
      setLoading(true);
      
      // Step 1: Get the definitive list of today's party entries. This is our source of truth.
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const { data: partyData, error: partyError } = await supabase
        .from('party_list')
        .select(`
          *,
          party_info:party_information(*),
          courier_agency:courier_agency_list(*)
        `)
        .gte('date', today.toISOString())
        .lt('date', tomorrow.toISOString())
        .order('created_at', { ascending: true });

      if (partyError) throw partyError;

      const processedPartyData = partyData?.map((entry, index) => ({
        ...entry,
        serialNumber: index + 1
      })) || [];
      
      // Step 2: Use the party list IDs to get the exact corresponding labels that already exist.
      // This is the key change to prevent the conflict error.
      const partyListIds = processedPartyData.map(p => p.id);
      const existingLabels = await getLabelPrintsByPartyIds(partyListIds);
      
      // Step 3: Generate labels for any parties that are missing one.
      const newLabelPrints = await generateAndPersistLabels(processedPartyData, existingLabels);
      
      // Step 4: Set the state once with the final, combined data.
      setTodayEntries(processedPartyData);
      setPersistedLabels([...existingLabels, ...newLabelPrints]);
      setTodayEntriesCount(processedPartyData.length);

    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  // This function's logic is correct and remains as it was.
  async function generateAndPersistLabels(currentEntries: PartyListEntry[], currentPersistedLabels: LabelPrintRecord[]): Promise<LabelPrintRecord[]> {
    if (currentEntries.length === 0) return [];
    
    try {
      setGeneratingQR(true);
      
      const existingLabelPartyIds = new Set(currentPersistedLabels.map(label => label.party_list_id));
      const newEntries = currentEntries.filter(entry => !existingLabelPartyIds.has(entry.id));
      
      if (newEntries.length > 0) {
        const { labelPrints } = await batchCreateLabelPrintRecords(newEntries.map((entry, index) => ({
          ...entry,
          serialNumber: currentPersistedLabels.length + index + 1
        })));
        
        toast.success(`Generated ${labelPrints.length} new labels.`);
        return labelPrints;
      } else {
        console.log('All labels already exist - no regeneration needed');
        return [];
      }
      
    } catch (error) {
      console.error('Error generating and persisting labels:', error);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('duplicate key')) {
        toast.error('Duplicate QR codes detected. Labels already exist.');
        return [];
      }
      
      toast.error('Failed to generate and save labels - using fallback mode');
      
      await generateLabelsInMemory();
      return [];
    } finally {
      setGeneratingQR(false);
    }
  }

  // *** END OF BUG FIX ***

  // The rest of this file is identical to your original version.
  
  async function updateSinglePartyLabel(partyListId: string, updatedData?: any) {
    try {
      console.log(`[LabelPrint] Updating single party label for: ${partyListId}`);
      
      let updatedPartyData;
      
      if (updatedData) {
        // Use provided data from sync event (faster)
        updatedPartyData = {
          id: partyListId,
          party_code: updatedData.party_code,
          bill_numbers: updatedData.bill_numbers,
          boxes: updatedData.boxes,
          courier_agency_id: updatedData.courier_agency_id,
          party_info: {
            party_name: updatedData.party_name,
            address: updatedData.address
          },
          courier_agency: updatedData.courier_agency
        };
        console.log('[LabelPrint] Using sync event data for update');
      } else {
        // Fallback: fetch from database
        const { data, error } = await supabase
          .from('party_list')
          .select(`
            *,
            party_info:party_information(*),
            courier_agency:courier_agency_list(*)
          `)
          .eq('id', partyListId)
          .single();

        if (error) {
          console.error(`[LabelPrint] Error fetching updated party data for ${partyListId}:`, error);
          toast.error(`Failed to fetch updated party data: ${handleSupabaseError(error)}`);
          return;
        }

        if (!data) {
          console.log(`[LabelPrint] Party ${partyListId} not found - may have been deleted`);
          // Remove from UI if party was deleted
          removeSinglePartyLabel(partyListId);
          toast.success('Removed deleted party from labels');
          return;
        }
        
        updatedPartyData = data;
        console.log('[LabelPrint] Fetched fresh data from database');
      }

      console.log('[LabelPrint] Updated party data:', {
        party_code: updatedPartyData.party_code,
        party_name: updatedPartyData.party_info?.party_name,
        boxes: updatedPartyData.boxes,
        courier: updatedPartyData.courier_agency?.agency_name,
        bill_numbers: updatedPartyData.bill_numbers
      });

      // Update persisted label record
      const { error: updateError } = await supabase
        .from('label_prints')
        .update({
          party_name: updatedPartyData.party_info?.party_name || 'Unknown Party',
          address: updatedPartyData.party_info?.address || 'Unknown Address',
          phone_number: updatedPartyData.party_info?.phone_number || null,
          bill_numbers: updatedPartyData.bill_numbers || [],
          boxes: updatedPartyData.boxes,
          transport: updatedPartyData.courier_agency?.agency_name || 'Unknown Transport',
          courier_agency_id: updatedPartyData.courier_agency_id,
          updated_at: new Date().toISOString()
        })
        .eq('party_list_id', partyListId);

      if (updateError) {
        console.error(`[LabelPrint] Error updating label print record for ${partyListId}:`, updateError);
        toast.error(`Failed to update label record: ${handleSupabaseError(updateError)}`);
        return;
      }

      console.log(`[LabelPrint] Successfully updated label_prints record for: ${partyListId}`);

      // Update local persisted labels state
      setPersistedLabels(prev => prev.map(label =>
        label.party_list_id === partyListId
          ? {
              ...label,
              party_name: updatedPartyData.party_info?.party_name || 'Unknown Party',
              address: updatedPartyData.party_info?.address || 'Unknown Address',
              phone_number: updatedPartyData.party_info?.phone_number || null,
              bill_numbers: updatedPartyData.bill_numbers || [],
              boxes: updatedPartyData.boxes,
              transport: updatedPartyData.courier_agency?.agency_name || 'Unknown Transport',
              courier_agency_id: updatedPartyData.courier_agency_id,
              updated_at: new Date().toISOString()
            }
          : label
      ));

      const partyName = updatedPartyData.party_info?.party_name || 'party';
      console.log(`[LabelPrint] Label updated for party: ${updatedPartyData.party_code} (${partyName})`);
      toast.success(`✓ Label updated: ${partyName} (boxes: ${updatedPartyData.boxes}, bills: ${updatedPartyData.bill_numbers?.length || 0})`, { duration: 3000 });
      
    } catch (error) {
      console.error('[LabelPrint] Error updating single party label:', error);
      toast.error(`Failed to update party label: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async function generateLabelsFromPersisted() {
    try {
      // Fetch box QR codes for all labels
      const labelIds = persistedLabels.map(l => l.id);
      const { data: boxQRCodesData, error: boxQRError } = await supabase
        .from('box_qr_codes')
        .select('label_print_id, qr_code')
        .in('label_print_id', labelIds)
        .order('box_number', { ascending: true });

      if (boxQRError) {
        console.error('Error fetching box QR codes:', boxQRError);
      }

      // Build map of label_print_id to box QR codes
      const boxQRMap = (boxQRCodesData || []).reduce((acc, box) => {
        if (!acc[box.label_print_id]) {
          acc[box.label_print_id] = [];
        }
        acc[box.label_print_id].push(box.qr_code);
        return acc;
      }, {} as Record<string, string[]>);

      setLabels(buildDisplayLabels(persistedLabels, boxQRMap));
    } catch (error) {
      console.error('Error generating labels from persisted data:', error);
      setLabels(buildDisplayLabels(persistedLabels));
      toast.error('Failed to generate QR preview, showing saved label data');
    }
  }

  async function generateLabelsInMemory() {
    try {
      setGeneratingQR(true);

      const labelPromises = todayEntries.map(async (entry) => {
        try {
          const uniqueId = Math.random().toString(36).substring(2, 8).toUpperCase();
          const barcodeCode = `DS${format(new Date(), 'yyMMdd')}${uniqueId}`;

          const qrCodeDataUrl = await QRCode.toDataURL(barcodeCode, {
            width: 85,
            margin: 1,
            errorCorrectionLevel: 'M'
          });

          return {
            id: entry.id,
            partyName: entry.party_info.party_name,
            address: entry.party_info.address,
            phoneNumber: entry.party_info.phone_number,
            boxes: entry.boxes,
            transport: entry.courier_agency.agency_name,
            qrCode: barcodeCode,
            qrCodeDataUrl: qrCodeDataUrl,
            partyCode: entry.party_code,
            billNumbers: entry.bill_numbers,
            courier_agency_id: entry.courier_agency_id
          };
        } catch (qrError) {
          console.error('QR code generation error:', qrError);
          const uniqueId = Math.random().toString(36).substring(2, 8).toUpperCase();
          const barcodeCode = `DS${format(new Date(), 'yyMMdd')}${uniqueId}`;
          return {
            id: entry.id,
            partyName: entry.party_info.party_name,
            address: entry.party_info.address,
            phoneNumber: entry.party_info.phone_number,
            boxes: entry.boxes,
            transport: entry.courier_agency.agency_name,
            qrCode: barcodeCode,
            qrCodeDataUrl: '',
            partyCode: entry.party_code,
            billNumbers: entry.bill_numbers,
            courier_agency_id: entry.courier_agency_id
          };
        }
      });

      const generatedLabels = await Promise.all(labelPromises);
      setLabels(generatedLabels);
      
      emitSyncEvent('update', 'label_print', 'generated', { count: generatedLabels.length }, 'label-print');
    } catch (error) {
      console.error('Error generating labels:', error);
      toast.error('Failed to generate labels');
    } finally {
      setGeneratingQR(false);
    }
  }
  
  function applyFiltersAndSearch() {
    setIsSearching(true);
    
    let filtered = [...labels];

    // Apply courier filter first
    if (selectedCourierId) {
      filtered = filtered.filter(label => label.courier_agency_id === selectedCourierId);
    }

    // Apply filter type
    if (filterType === 'couriers') {
      filtered = filtered.filter(label => 
        !label.transport.toLowerCase().includes('by-hand') &&
        !label.transport.toLowerCase().includes('by hand') &&
        !label.transport.toLowerCase().includes('byhand')
      );
    } else if (filterType === 'byhand') {
      filtered = filtered.filter(label => 
        label.transport.toLowerCase().includes('by-hand') ||
        label.transport.toLowerCase().includes('by hand') ||
        label.transport.toLowerCase().includes('byhand')
      );
    }

    // Apply search
    if (searchTerm.trim()) {
      const searchLower = searchTerm.toLowerCase().trim();
      filtered = filtered.filter(label =>
        label.partyName.toLowerCase().includes(searchLower) ||
        label.partyCode.toLowerCase().includes(searchLower) ||
        label.billNumbers.some(bill => bill.toLowerCase().includes(searchLower))
      );
    }

    setFilteredLabels(filtered);
    setIsSearching(false);

    if (searchTerm.trim() && filtered.length === 0) {
      toast.error('No matching labels found');
    }
  }

  async function handleSyncNow() {
    setIsSyncing(true);
    try {
      // Explicit user action - reload all data while preserving scan state
      console.log('Force refresh triggered by user');
      await loadTodayData();
      await refreshTodayEntriesCount();
      toast.success('Labels refreshed successfully - scan state preserved');
    } catch (error) {
      toast.error('Failed to refresh labels');
    } finally {
      setIsSyncing(false);
    }
  }

  function clearSearch() {
    setSearchTerm('');
    toast.success('Search cleared - showing all labels');
  }

  // Helper function to format invoice numbers with line breaks
  function formatInvoiceNumbers(billNumbers: string[]): string {
    if (billNumbers.length === 0) return '';

    const chunks = [];

    // First row: 5 invoices
    if (billNumbers.length > 0) {
      chunks.push(billNumbers.slice(0, 5).join(', '));
    }

    // Second row: 5 invoices
    if (billNumbers.length > 5) {
      chunks.push(billNumbers.slice(5, 10).join(', '));
    }

    // Third row: 7 invoices (or remaining)
    if (billNumbers.length > 10) {
      chunks.push(billNumbers.slice(10, 17).join(', '));
    }

    return chunks.join('<br>');
  }

  // Generate just the label content (no HTML document structure)
  function createLabelContent(
    label: LabelData,
    boxNumber?: number,
    boxQRCodeDataUrl?: string
  ): string {
    const qrCodeUrl = boxQRCodeDataUrl || label.qrCodeDataUrl;
    const boxDisplay = boxNumber ? `Box ${boxNumber}/${label.boxes}` : `${label.boxes}`;

    return `
      <div class="label-container">
        <div class="content">
          <div class="left-info">
            <div class="party-name">${label.partyName}</div>
            <div class="address">${label.address}${label.phoneNumber ? ', ' + label.phoneNumber : ''}</div>
            <span class="invoice-numbers">Inv No: ${formatInvoiceNumbers(label.billNumbers)}</span>
          </div>

          <div class="qr-container">
            <img src="${qrCodeUrl}" alt="QR Code" class="qr-code" />
          </div>
        </div>

        <div class="boxes-transport">
          <span>Transporter: ${label.transport}</span>&nbsp;&nbsp;&nbsp;&nbsp;<span>Boxes: <span class="boxes-number">${boxDisplay}</span></span>
        </div>

        <div class="footer">
          <div class="footer-left">
            <div class="company-name">${co.company_name.toUpperCase()}${co.address ? ` - ${co.address.toUpperCase()}` : ''}</div>
            <div class="contact-info">Contact: ${co.parcel_dept_phone}</div>
          </div>
          <div class="footer-right">
            <span class="fragile-label">FRAGILE</span>
            <span class="handle-care-label">HANDLE WITH CARE</span>
          </div>
        </div>
      </div>
    `;
  }

  // Wrap multiple label contents in a single HTML document
  function createLabelsDocument(labelContents: string[]): string {
    // Join all labels without extra page breaks - .label-container CSS already handles pagination
    const labelsWithBreaks = labelContents.join('\n');

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Label Print</title>
          <style>
            @page {
              size: 10cm 5cm;
              margin: 0;
            }

            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }

            body {
              font-family: Arial, sans-serif;
              background: white;
            }

            .label-container {
              position: relative;   
              width: 10cm;
              height: 5cm;
              min-height: 5cm;
              max-height: 5cm;
              border: 2px solid #000;
              display: flex;
              flex-direction: column;
              padding: 0.3cm;
              box-sizing: border-box;
              overflow: hidden;
              page-break-after: always;
              page-break-inside: avoid;
              break-after: page;
              break-inside: avoid;
            }

            .content {
              flex: 1 1 auto;
              min-height: 0;
              display: flex;
              flex-direction: column;
              gap: 6px;
            }

            .left-info {
              flex: 1;
            }

            .party-name {
              font-size: 16px;
              font-weight: bold;
              margin-bottom: 4px;
            }

            .address {
              font-size: 14px;
              font-weight: bold;
              margin-bottom: 6px;
            }

            .invoice-numbers {
              font-size: 10px;
              margin-bottom: 4px;
              font-weight: bold;
              line-height: 1.3;
              max-width: 65%;
              display: inline;
            }

            .qr-code {
              width: 85px;
              height: 85px;
            }

 .qr-container {
  position: absolute;
  right: 0.4cm;
  bottom: calc(0.3cm + 32px); /* ⬆ moved up slightly */
  width: 85px;
  height: 85px;
}



            .boxes-transport {
              margin-top: 8px;
              margin-bottom: 8px;
              font-size: 10px;
              font-weight: bold;
              text-align: left;
            }

            .boxes-number {
              display: inline-block;
              border: 1px solid #000;
              padding: 1px 3px;
              margin-left: 2px;
            }

            .footer {
              margin-top: auto;
              text-align: center;
              padding-top: 4px;
              border-top: 1px solid #000;
              display: flex;
              justify-content: space-between;
              align-items: center;
            }

            .footer-left {
              text-align: left;
            }

            .footer-right {
              text-align: right;
              display: flex;
              flex-direction: column;
              align-items: flex-end;
              gap: 2px;
            }

            .company-name {
              font-size: 11px;
              font-weight: bold;
              margin-bottom: 2px;
              line-height: 1.2;
            }

            .contact-info {
              font-size: 9px;
              font-weight: bold;
              line-height: 1.2;
            }

            .fragile-label {
              font-size: 9px;
              font-weight: bold;
              text-transform: uppercase;
            }

            .handle-care-label {
              font-size: 8px;
              font-weight: bold;
              text-transform: uppercase;
            }

            @media print {
              body {
                margin: 0;
                padding: 0;
                overflow: hidden;
                -webkit-print-color-adjust: exact;
              }
            }
          </style>
        </head>
        <body>
          ${labelsWithBreaks}
        </body>
      </html>
    `;
  }

  async function printLabel(label: LabelData) {
    setIsPrintingLabel(label.id);

    try {
      console.log('[printLabel] Starting print for label:', label.id, label.partyName);
      const boxCount = label.boxes || 1;
      toast.loading(`Printing ${boxCount} label(s) for ${label.partyName}...`, { id: 'print-single' });

      const persistedLabel = persistedLabels.find(pl => pl.party_list_id === label.id);
      console.log('[printLabel] Found persisted label:', persistedLabel?.id);
      if (!persistedLabel) {
        throw new Error('Label record not found in database');
      }

      console.log('[printLabel] Getting/generating box QR codes...');
      const boxQRCodes = await getOrGenerateBoxQRCodes(persistedLabel.id, boxCount);
      console.log('[printLabel] Got QR codes:', boxQRCodes.length);

      if (boxQRCodes.length === 0) {
        throw new Error('No QR codes generated');
      }

      console.log('[printLabel] Creating print iframe...');
      const iframe = document.createElement('iframe');
      iframe.style.position = 'absolute';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = 'none';
      document.body.appendChild(iframe);

      const iframeDoc = iframe.contentWindow?.document;
      if (!iframeDoc) {
        throw new Error('Failed to create print document');
      }

      console.log('[printLabel] Generating QR code images...');
      const labelContents: string[] = [];
      for (const boxQR of boxQRCodes) {
        const qrCodeDataUrl = await QRCode.toDataURL(boxQR.qr_code, {
          width: 85,
          margin: 1,
          errorCorrectionLevel: 'M'
        });
        labelContents.push(createLabelContent(label, boxQR.box_number, qrCodeDataUrl));
      }

      console.log('[printLabel] Writing to print document...');
      const htmlDocument = createLabelsDocument(labelContents);

      iframeDoc.open();
      iframeDoc.write(htmlDocument);
      iframeDoc.close();

      iframe.onload = () => {
        setTimeout(() => {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();

          setTimeout(() => {
            document.body.removeChild(iframe);
          }, 1000);

          toast.success(`${boxCount} label(s) printed for ${label.partyName}`, { id: 'print-single' });
          setIsPrintingLabel(null);
        }, 500);
      };

      console.log('[printLabel] Marking label as printed...');
      if (persistedLabel) {
        await markLabelAsPrinted(persistedLabel.id);
        setPersistedLabels(prev =>
          prev.map(pl =>
            pl.id === persistedLabel.id
              ? { ...pl, is_printed: true, printed_at: new Date().toISOString() }
              : pl
          )
        );
      }

      console.log('[printLabel] Print successful');

    } catch (error) {
      console.error('[printLabel] Error:', error);
      console.error('[printLabel] Error stack:', error instanceof Error ? error.stack : 'No stack');
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.error(`Print failed: ${errorMessage}`, { id: 'print-single' });
      setIsPrintingLabel(null);
    }
  }

  function viewLabel(label: LabelData) {
    setPreviewLabel(label);
    setShowPreview(true);
  }

  function closePreview() {
    setShowPreview(false);
    setPreviewLabel(null);
  }

  async function printAllLabels() {
    const courierLabels = filteredLabels.filter(label =>
      !label.transport.toLowerCase().includes('by-hand') &&
      !label.transport.toLowerCase().includes('by hand') &&
      !label.transport.toLowerCase().includes('byhand')
    );

    if (courierLabels.length === 0) {
      toast.error('No courier labels to print');
      return;
    }

    setIsPrintingAll(true);

    const totalLabels = courierLabels.reduce((sum, label) => sum + (label.boxes || 1), 0);
    toast.loading(`Printing ${totalLabels} label(s) from ${courierLabels.length} entries...`, { id: 'print-all' });

    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'absolute';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = 'none';
      document.body.appendChild(iframe);

      const iframeDoc = iframe.contentWindow?.document;
      if (!iframeDoc) {
        throw new Error('Failed to create print document');
      }

      const labelContents: string[] = [];

      for (const label of courierLabels) {
        const persistedLabel = persistedLabels.find(pl => pl.party_list_id === label.id);
        if (!persistedLabel) continue;

        const boxQRCodes = await getOrGenerateBoxQRCodes(persistedLabel.id, label.boxes);

        for (const boxQR of boxQRCodes) {
          const qrCodeDataUrl = await QRCode.toDataURL(boxQR.qr_code, {
            width: 85,
            margin: 1,
            errorCorrectionLevel: 'M'
          });
          labelContents.push(createLabelContent(label, boxQR.box_number, qrCodeDataUrl));
        }
      }

      const htmlDocument = createLabelsDocument(labelContents);

      iframeDoc.open();
      iframeDoc.write(htmlDocument);
      iframeDoc.close();

      await new Promise<void>((resolve) => {
        iframe.onload = () => {
          setTimeout(() => {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();

            setTimeout(() => {
              document.body.removeChild(iframe);
              resolve();
            }, 1000);
          }, 500);
        };
      });

      const labelIds = courierLabels
        .map(label => persistedLabels.find(pl => pl.party_list_id === label.id)?.id)
        .filter((id): id is string => id !== undefined);

      if (labelIds.length > 0) {
        await markLabelsAsPrinted(labelIds);
        const labelIdsSet = new Set(labelIds);
        setPersistedLabels(prev =>
          prev.map(pl =>
            labelIdsSet.has(pl.id)
              ? { ...pl, is_printed: true, printed_at: new Date().toISOString() }
              : pl
          )
        );
      }

      toast.success(`${totalLabels} label(s) printed from ${courierLabels.length} entries!`, { id: 'print-all' });
      setIsPrintingAll(false);

    } catch (error) {
      console.error('Error printing all labels:', error);
      toast.error('Failed to print all labels', { id: 'print-all' });
      setIsPrintingAll(false);
    }
  }

  function handleEditBoxes(labelId: string, currentBoxes: number) {
    setEditingBoxesId(labelId);
    setEditingBoxesValue(currentBoxes);
  }

  function handleCancelEditBoxes() {
    setEditingBoxesId(null);
    setEditingBoxesValue(0);
  }

  async function handleSaveBoxes(label: LabelData) {
    if (!editingBoxesId || editingBoxesValue < 1) {
      toast.error('Boxes must be at least 1');
      return;
    }

    if (editingBoxesValue > 50) {
      toast.error('Box limit exceeded. Maximum allowed boxes per party is 50.');
      return;
    }

    const oldBoxCount = label.boxes;
    const newBoxCount = editingBoxesValue;

    if (oldBoxCount === newBoxCount) {
      toast.error('Box count has not changed');
      setEditingBoxesId(null);
      setEditingBoxesValue(0);
      return;
    }

    const persistedLabel = persistedLabels.find(pl => pl.party_list_id === label.id);
    if (!persistedLabel) {
      toast.error('Label record not found in database');
      setEditingBoxesId(null);
      setEditingBoxesValue(0);
      return;
    }

    // Get current scan status before updating
    const { data: existingBoxes } = await supabase
      .from('box_qr_codes')
      .select('box_number, scanned')
      .eq('label_print_id', persistedLabel.id)
      .order('box_number');

    const scannedCount = existingBoxes?.filter(b => b.scanned).length || 0;

    // If reducing boxes, show confirmation dialog
    if (newBoxCount < oldBoxCount) {
      const removed = oldBoxCount - newBoxCount;
      const boxesToBeRemoved = existingBoxes?.filter(b => b.box_number > newBoxCount) || [];
      const scannedBoxesToBeRemoved = boxesToBeRemoved.filter(b => b.scanned).length;

      let message = `You are about to reduce the box count from ${oldBoxCount} to ${newBoxCount}.\n\n`;
      message += `This will remove ${removed} box${removed > 1 ? 'es' : ''} (Box ${newBoxCount + 1}`;
      if (removed > 1) {
        message += ` to Box ${oldBoxCount}`;
      }
      message += `).\n\n`;

      if (scannedBoxesToBeRemoved > 0) {
        message += `⚠️ WARNING: ${scannedBoxesToBeRemoved} of the removed box${scannedBoxesToBeRemoved > 1 ? 'es have' : ' has'} already been scanned. This scan data will be permanently deleted.\n\n`;
      }

      message += `Do you want to continue?`;

      const confirmed = await openConfirmDialog({
        title: 'Reduce Box Count',
        message,
        confirmText: 'Yes, Reduce Boxes',
        cancelText: 'Cancel',
        variant: scannedBoxesToBeRemoved > 0 ? 'danger' : 'primary'
      });

      if (!confirmed) {
        setEditingBoxesId(null);
        setEditingBoxesValue(0);
        return;
      }
    }

    try {
      toast.loading(`Updating boxes...`, { id: 'save-boxes' });

      // Update label_prints - the database trigger will automatically sync to party_list
      const { error: labelError } = await supabase
        .from('label_prints')
        .update({
          boxes: newBoxCount,
          updated_at: new Date().toISOString()
        })
        .eq('id', persistedLabel.id);

      if (labelError) {
        throw labelError;
      }

      // Regenerate box QR codes with the new count
      const newBoxQRCodes = await regenerateBoxQRCodes(persistedLabel.id, newBoxCount);

      setPersistedLabels(prevLabels => {
        const updated = prevLabels.map(l =>
          l.party_list_id === label.id
            ? { ...l, boxes: newBoxCount, updated_at: new Date().toISOString(), box_qr_codes: newBoxQRCodes }
            : l
        );
        return updated;
      });

      setLabels(prevLabels => {
        const updated = prevLabels.map(l =>
          l.id === label.id
            ? { ...l, boxes: newBoxCount, box_qr_codes: newBoxQRCodes.map(qr => qr.qr_code) }
            : l
        );
        return updated;
      });

      setFilteredLabels(prevFiltered =>
        prevFiltered.map(l =>
          l.id === label.id
            ? { ...l, boxes: newBoxCount, box_qr_codes: newBoxQRCodes.map(qr => qr.qr_code) }
            : l
        )
      );

      emitSyncEvent('update', 'label_print', label.id, {
        ...label,
        boxes: newBoxCount
      }, 'label-print');

      // Provide detailed feedback based on the change
      let successMessage = `${label.partyName}: `;
      if (newBoxCount > oldBoxCount) {
        const added = newBoxCount - oldBoxCount;
        successMessage += `Added ${added} box${added > 1 ? 'es' : ''}`;
        if (scannedCount > 0) {
          successMessage += ` (${scannedCount} already scanned preserved)`;
        }
      } else if (newBoxCount < oldBoxCount) {
        const removed = oldBoxCount - newBoxCount;
        const boxesToBeRemoved = existingBoxes?.filter(b => b.box_number > newBoxCount) || [];
        const scannedBoxesDeleted = boxesToBeRemoved.filter(b => b.scanned).length;

        successMessage += `Removed ${removed} box${removed > 1 ? 'es' : ''}`;
        if (scannedBoxesDeleted > 0) {
          successMessage += ` (${scannedBoxesDeleted} scanned box${scannedBoxesDeleted > 1 ? 'es' : ''} deleted)`;
        }
      }

      toast.success(successMessage, { id: 'save-boxes', duration: 4000 });

      setEditingBoxesId(null);
      setEditingBoxesValue(0);
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(`Failed to update boxes: ${errorMessage}`, { id: 'save-boxes' });
    }
  }

  function downloadLabelsData() {
    const dataToDownload = filteredLabels;
    const csv = [
      ['S.No', 'QR Code', 'Party Code', 'Party Name', 'Address', 'Bill Numbers', 'Boxes', 'Transporter'],
      ...dataToDownload.map((label, index) => [
        index + 1,
        label.qrCode,
        label.partyCode,
        label.partyName,
        label.address,
        label.billNumbers.join('; '),
        label.boxes,
        label.transport
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const filename = `${filterType}_labels_data_${formatDate(new Date())}.csv`;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  const selectedCourier = courierAgencies.find(c => c.id === selectedCourierId);

  return (
    <div className="rounded-xl border border-gray-200 shadow-sm bg-white overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Printer className="w-4 h-4 text-blue-600" />
            Label Print
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {filteredLabels.length} {filterType === 'couriers' ? 'courier' : 'by-hand'} labels
            {todayEntriesCount > 0 && <span className="ml-1">• {todayEntriesCount} today</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            onClick={handleSyncNow}
            disabled={isSyncing}
            title={isSyncing ? 'Syncing...' : 'Sync Now'}
            className="p-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 text-gray-600 ${isSyncing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={downloadLabelsData}
            disabled={filteredLabels.length === 0}
            title="Download Data"
            className="p-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
          >
            <Download className="w-4 h-4 text-gray-600" />
          </button>
          {filterType === 'couriers' && (
            <button
              onClick={printAllLabels}
              disabled={filteredLabels.length === 0 || generatingQR || isPrintingAll}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Printer className="w-3.5 h-3.5" />
              {isPrintingAll ? 'Printing...' : 'Print All'}
            </button>
          )}
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setFilterType('couriers')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                filterType === 'couriers' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Couriers ({labels.filter(l => !l.transport.toLowerCase().includes('by-hand') && !l.transport.toLowerCase().includes('by hand') && !l.transport.toLowerCase().includes('byhand')).length})
            </button>
            <button
              onClick={() => setFilterType('byhand')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                filterType === 'byhand' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              By Hand ({labels.filter(l => l.transport.toLowerCase().includes('by-hand') || l.transport.toLowerCase().includes('by hand') || l.transport.toLowerCase().includes('byhand')).length})
            </button>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-3 bg-gray-50/50 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search name, code, bill…"
            className="h-9 w-full pl-9 pr-8 text-sm text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {searchTerm && (
            <button
              onClick={clearSearch}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <select
          value={selectedCourierId}
          onChange={(e) => {
            setSelectedCourierId(e.target.value);
            if (e.target.value) {
              const courier = courierAgencies.find(c => c.id === e.target.value);
              const parcelCount = courierCounts[e.target.value] || 0;
              toast.success(`Filtered to ${courier?.agency_name || 'selected courier'} (${parcelCount} parcels)`);
            } else {
              toast.success('Showing all couriers');
            }
          }}
          className="h-9 px-3 text-sm text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Couriers</option>
          {courierAgencies.map((agency) => {
            const count = courierCounts[agency.id] || 0;
            return (
              <option key={agency.id} value={agency.id}>
                {agency.agency_name} ({count})
              </option>
            );
          })}
        </select>
        {generatingQR && (
          <div className="flex items-center gap-2 text-xs text-blue-600">
            <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-blue-500"></div>
            Generating QR codes…
          </div>
        )}
        {selectedCourierId && selectedCourier && (
          <span className="text-xs text-gray-500">
            {selectedCourier.agency_name} • {filteredLabels.length} labels
          </span>
        )}
      </div>

      {/* Table / Empty State */}
      {loading ? (
        <div className="py-16 text-center">
          <LoadingSpinner size="sm" message="Loading label data..." />
        </div>
      ) : filteredLabels.length === 0 ? (
        <div className="py-16 text-center">
          <Package className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-600">
            {searchTerm ? 'No Matching Labels Found' : `No ${filterType === 'couriers' ? 'Courier' : 'By-Hand'} Labels`}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {searchTerm
              ? `No labels match "${searchTerm}". Try different search terms.`
              : 'No data found for today.'
            }
          </p>
          {(searchTerm || selectedCourierId) && (
            <button
              onClick={() => { clearSearch(); setSelectedCourierId(''); }}
              className="mt-4 px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Clear All Filters
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">S.No</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">QR Code</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Party</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Address</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Invoices</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Boxes</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Transporter</th>
                {filterType === 'couriers' && (
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredLabels.map((label, index) => {
                const persistedLabel = persistedLabels.find(pl => pl.party_list_id === label.id);
                const isPrinted = persistedLabel?.is_printed || false;
                return (
                  <tr key={label.id} className={`hover:bg-gray-50 transition-colors ${isPrinted ? 'bg-green-50' : ''}`}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-800 whitespace-nowrap">{index + 1}</td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-700">
                      {label.box_qr_codes && label.box_qr_codes.length > 0 ? (
                        <div className="flex flex-col gap-0.5">
                          {label.box_qr_codes.map((qr, idx) => <div key={idx}>{qr}</div>)}
                        </div>
                      ) : (
                        label.qrCode
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-800">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{label.partyName}</span>
                        {isPrinted && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold bg-green-600 text-white">P</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">Code: {label.partyCode}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{label.address}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full text-xs font-medium">
                          {label.billNumbers.length} inv
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {label.billNumbers.slice(0, 5).map((bill, i) => (
                          <span key={i} className="bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded text-xs text-gray-700">{bill}</span>
                        ))}
                        {label.billNumbers.length > 5 && (
                          <span className="text-xs text-gray-500">+{label.billNumbers.length - 5} more</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-800 whitespace-nowrap">
                      <button
                        onClick={() => handleEditBoxes(label.id, label.boxes)}
                        className="font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                        title="Edit boxes"
                      >
                        {label.boxes}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{label.transport}</td>
                    {filterType === 'couriers' && (
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => viewLabel(label)}
                            title="View Label"
                            className="p-1.5 rounded border border-gray-200 hover:bg-green-50 hover:border-green-300"
                          >
                            <Eye className="w-3.5 h-3.5 text-green-600" />
                          </button>
                          <button
                            onClick={() => printLabel(label)}
                            disabled={isPrintingLabel === label.id || generatingQR}
                            title="Print Label"
                            className="p-1.5 rounded border border-gray-200 hover:bg-blue-50 hover:border-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isPrintingLabel === label.id ? (
                              <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-blue-500"></div>
                            ) : (
                              <Printer className="w-3.5 h-3.5 text-blue-600" />
                            )}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      <div className="px-6 py-3 border-t border-gray-100 bg-gray-50/50">
        <p className="text-xs text-gray-500">
          Label size: 10cm × 5cm • Contact: {co.parcel_dept_phone} • Print All works for courier labels only
        </p>
      </div>

      <EditDialog
        open={!!editingBoxesLabel}
        title={`Edit Boxes${editingBoxesLabel ? ` - ${editingBoxesLabel.partyName}` : ''}`}
        onClose={handleCancelEditBoxes}
        footer={
          <>
            <button
              type="button"
              onClick={handleCancelEditBoxes}
              className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => editingBoxesLabel && handleSaveBoxes(editingBoxesLabel)}
              className="px-4 py-2 text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              Save Changes
            </button>
          </>
        }
      >
        {editingBoxesLabel && (
          <div className="space-y-4">
            <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-800">
              <div className="font-semibold">{editingBoxesLabel.partyName}</div>
              <div>Party Code: {editingBoxesLabel.partyCode}</div>
              <div>Transporter: {editingBoxesLabel.transport}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Boxes
              </label>
              <input
                type="number"
                min="1"
                max="50"
                value={editingBoxesValue}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 1;
                  if (val > 50) {
                    toast.error('Box limit exceeded. Maximum allowed boxes per party is 50.');
                    setEditingBoxesValue(50);
                  } else {
                    setEditingBoxesValue(Math.max(1, Math.min(50, val)));
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSaveBoxes(editingBoxesLabel);
                  } else if (e.key === 'Escape') {
                    handleCancelEditBoxes();
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>
          </div>
        )}
      </EditDialog>

      {/* Label Preview Modal */}
      {showPreview && previewLabel && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-auto">
            <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">Label Preview — {previewLabel.partyName}</h3>
              <button onClick={closePreview} className="p-1.5 rounded border border-gray-200 hover:bg-gray-50">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            <div className="p-6 flex justify-center">
              <div
                className="border-2 border-gray-300 bg-white"
                style={{ width: '380px', height: '190px', transform: 'scale(1.5)', transformOrigin: 'center' }}
              >
                <div className="w-full h-full border-2 border-black flex flex-col p-2 box-border relative">
                  <div className="flex-1 flex flex-col gap-1 pr-16">
                    <div className="flex-1">
                      <div className="text-sm font-bold mb-1">{previewLabel.partyName}</div>
                      <div className="text-sm font-bold mb-1">{previewLabel.address}{previewLabel.phoneNumber ? `, ${previewLabel.phoneNumber}` : ''}</div>
                      <span className="text-xs font-bold">
                        Inv No:{" "}
                        {(() => {
                          if (previewLabel.billNumbers.length === 0) return '';
                          const chunks = [];
                          if (previewLabel.billNumbers.length > 0) chunks.push(previewLabel.billNumbers.slice(0, 5).join(', '));
                          if (previewLabel.billNumbers.length > 5) chunks.push(previewLabel.billNumbers.slice(5, 10).join(', '));
                          if (previewLabel.billNumbers.length > 10) chunks.push(previewLabel.billNumbers.slice(10, 17).join(', '));
                          return chunks.map((chunk, i) => <div key={i}>{chunk}</div>);
                        })()}
                      </span>
                    </div>
                  </div>
                  <div className="absolute right-3 top-2 flex items-center justify-center text-center w-20">
                    <div className="text-[10px] font-bold font-mono break-all leading-tight">
                      {previewLabel.box_qr_codes && previewLabel.box_qr_codes.length > 0
                        ? previewLabel.box_qr_codes[0]
                        : previewLabel.qrCode}
                    </div>
                  </div>
                  <div className="text-xs font-bold mt-3 flex justify-between items-center">
                    <div className="text-left">
                      <span>Transporter: {previewLabel.transport}</span>
                      <span className="ml-4">Boxes: <span className="border border-black px-1">{previewLabel.boxes}</span></span>
                    </div>
                  </div>
                  <div className="mt-auto text-center pt-1 border-t border-black">
                    <div className="flex justify-between items-center">
                      <div className="text-left">
                        <div className="text-xs font-bold mb-1">{co.company_name.toUpperCase()}{co.address ? ` - ${co.address.toUpperCase()}` : ''}</div>
                        <div className="text-xs font-bold">Contact: {co.parcel_dept_phone}</div>
                      </div>
                      <div className="text-right flex flex-col items-end gap-0.5">
                        <span className="text-xs font-bold">FRAGILE</span>
                        <span className="text-xs font-bold">HANDLE WITH CARE</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
              <button onClick={closePreview} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                Close
              </button>
              <button
                onClick={() => { printLabel(previewLabel); closePreview(); }}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
              >
                <Printer className="w-4 h-4" />
                Print This Label
              </button>
            </div>
          </div>
        </div>
      )}

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
