import React, { useState, useEffect, useRef } from 'react';
import { supabase, handleSupabaseError } from '../lib/supabase';
import {
  getTodaysScanTally,
  markBarcodeAsScanned,
  getScanProgress,
  revertAllScannedEntries,
  ScanTallyRecord
} from '../lib/labelPersistence';
import { useRealtimeSync, emitSyncEvent } from '../lib/realtimeSync';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { Scan, Search, RefreshCw, RotateCcw, Package, AlertTriangle, CheckCircle, Clock, X, Filter, Building2, Flag } from 'lucide-react';
import { formatTime } from '../lib/dateUtils';
import toast from 'react-hot-toast';

// const BARCODE_CONFIG = {
//   REGEX: /^DS\d{6}[A-Z0-9]{6}(-B\d+)?$/,  // DS + 6 digits + 6 alphanumeric + optional box number (-B1, -B2, etc.)
//   MIN_LENGTH: 14,                         // Minimum length (without box number suffix)
//   MAX_LENGTH: 20,                         // Maximum length (with box number suffix)
//   AUTO_SUBMIT_DELAY: 10,                  // Ultra-fast: 10ms for instant scanning
//   DEBOUNCE_WINDOW: 20                     // Ultra-fast: 20ms debounce
// };
// ============================================================
// CHANGE THIS in ScanTallyTab.tsx
// Find the BARCODE_CONFIG block at the top of the file and
// replace it with the version below.
//
// The only change is in REGEX — removed the (-B\d+)? suffix
// since box QR codes are now fully unique standalone codes.
// MIN_LENGTH, MAX_LENGTH, and timing values are unchanged.
// ============================================================

const BARCODE_CONFIG = {
  REGEX: /^DS\d{6}[A-Z0-9]{6}$/,  // DS + 6 digits + 6 alphanumeric — no suffix needed, each box QR is fully unique
  MIN_LENGTH: 14,                   // Unchanged — DS(2) + date(6) + uniqueId(6) = 14 chars exactly
  MAX_LENGTH: 14,                   // Now fixed at exactly 14 — no suffix variation
  AUTO_SUBMIT_DELAY: 10,            // Ultra-fast: 10ms for instant scanning
  DEBOUNCE_WINDOW: 500              // 500ms debounce — prevents double submission
};

// Audio feedback for scans
const audioContext = typeof window !== 'undefined' ? new (window.AudioContext || (window as any).webkitAudioContext)() : null;

function playSuccessSound() {
  if (!audioContext) return;

  try {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
    oscillator.frequency.setValueAtTime(1000, audioContext.currentTime + 0.1);

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.2);
  } catch (error) {
    console.warn('Could not play success sound:', error);
  }
}

function playErrorSound() {
  if (!audioContext) return;

  try {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.setValueAtTime(400, audioContext.currentTime);
    oscillator.frequency.setValueAtTime(200, audioContext.currentTime + 0.1);

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
  } catch (error) {
    console.warn('Could not play error sound:', error);
  }
}

interface CourierAgency {
  id: string;
  agency_name: string;
  agency_number: string;
}

interface ScanProgress {
  total: number;
  scanned: number;
  missing: number;
  partial: number;
  percentage: number;
}

type StatusFilter = 'all' | 'scanned' | 'partial' | 'missing';

export function ScanTallyTab() {
  const { dialogState, openConfirmDialog, handleConfirm, handleCancel } = useConfirmDialog();
  const [scanTallyRecords, setScanTallyRecords] = useState<ScanTallyRecord[]>([]);
  const [courierAgencies, setCourierAgencies] = useState<CourierAgency[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanProgress, setScanProgress] = useState<ScanProgress>({
    total: 0,
    scanned: 0,
    missing: 0,
    partial: 0,
    percentage: 0
  });
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredRecords, setFilteredRecords] = useState<ScanTallyRecord[]>([]);
  const [isReverting, setIsReverting] = useState(false);
  const [lastScannedId, setLastScannedId] = useState<string | null>(null);
  const [activeStatusFilter, setActiveStatusFilter] = useState<StatusFilter>('all');
  const [selectedCourierId, setSelectedCourierId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastSubmissionTime, setLastSubmissionTime] = useState(0);
  const autoSubmitTimeoutRef = useRef<NodeJS.Timeout | null>(null); // ref for sync cancellation
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Date range filter state - use local date to avoid timezone issues
  const getLocalDateString = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const today = getLocalDateString();
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);

  // ULTRA-FAST: In-memory cache for instant lookups
  const qrCacheRef = useRef<Map<string, {
    id: string;
    party_code: string;
    party_name: string;
    courier_agency_id: string;
    boxes: number;
    scanned_count: number;
    is_flagged: boolean;
  }>>(new Map());
  const scanQueueRef = useRef<string[]>([]);
  const isProcessingQueueRef = useRef(false);

  // Real-time sync setup - only respond to label print changes
  useRealtimeSync(
    ['party_list', 'label_print'],
    async (event) => {
      if (event.source === 'label-print' && event.type === 'update') {
        console.log('Real-time sync triggered in ScanTallyTab from label-print:', event);
        // Only refresh if new labels were generated
        if (event.data?.count > 0) {
          await loadScanTallyData();
        }
      } else if (event.source === 'history' && event.type === 'update') {
        console.log('[ScanTally] Processing History edit for party:', event.entityId);
        // Update only the affected party's row
        await updateSinglePartyRow(event.entityId);
      }
    },
    []
  );

  useEffect(() => {
    loadScanTallyData();
  }, [dateFrom, dateTo]);

  useEffect(() => {
    applyFilters();
  }, [scanTallyRecords, searchTerm, activeStatusFilter, selectedCourierId]);

  // Auto-focus barcode input
  useEffect(() => {
    const focusInput = () => {
      if (barcodeInputRef.current && !isScanning && !isSubmitting) {
        barcodeInputRef.current.focus();
      }
    };
    
    // Focus immediately
    focusInput();
    
    // Also focus when returning to tab (visibility change)
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        setTimeout(focusInput, 100);
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isScanning, isSubmitting]);

  // Auto-submit when barcode is complete
  useEffect(() => {
    if (autoSubmitTimeoutRef.current) {
      clearTimeout(autoSubmitTimeoutRef.current);
      autoSubmitTimeoutRef.current = null;
    }

    if (barcodeInput.trim() && !isSubmitting && !isScanning) {
      // Check if barcode matches expected format
      if (isValidBarcode(barcodeInput.trim())) {
        // Auto-submit after stabilization delay
        autoSubmitTimeoutRef.current = setTimeout(() => {
          handleAutoSubmit();
        }, BARCODE_CONFIG.AUTO_SUBMIT_DELAY);
      }
    }

    return () => {
      if (autoSubmitTimeoutRef.current) {
        clearTimeout(autoSubmitTimeoutRef.current);
        autoSubmitTimeoutRef.current = null;
      }
    };
  }, [barcodeInput, isSubmitting, isScanning]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (autoSubmitTimeoutRef.current) {
        clearTimeout(autoSubmitTimeoutRef.current);
        autoSubmitTimeoutRef.current = null;
      }
    };
  }, []);

  // Enhanced auto-focus management
  useEffect(() => {
    const refocusInput = () => {
      if (barcodeInputRef.current) {
        barcodeInputRef.current.focus();
      }
    };
    
    // Re-focus after any state change that might affect focus
    const timer = setTimeout(refocusInput, 50);
    return () => clearTimeout(timer);
  }, [lastScannedId, activeStatusFilter, selectedCourierId]);

  // Highlight last scanned entry
  useEffect(() => {
    if (lastScannedId) {
      const timer = setTimeout(() => {
        setLastScannedId(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [lastScannedId]);

  async function loadScanTallyData() {
    try {
      setLoading(true);

      const [scanTallyData, progressData] = await Promise.all([
        getTodaysScanTallyIncludingFlagged(),
        getScanProgress(dateFrom, dateTo),
        fetchCourierAgencies()
      ]);

      setScanTallyRecords(scanTallyData);
      setScanProgress(progressData);

      // ULTRA-FAST: Populate in-memory cache for instant lookups
      await populateQRCache(scanTallyData);

    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(`Failed to load scan tally: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  }

  // ULTRA-FAST: Populate cache with all QR codes for instant lookups
  async function populateQRCache(records: ScanTallyRecord[]) {
    try {
      const fromDate = new Date(dateFrom);
      fromDate.setHours(0, 0, 0, 0);

      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);

      // Get all label prints and flagged parties in parallel
      const [labelPrintsResult, flaggedResult] = await Promise.all([
        supabase
          .from('label_prints')
          .select('id, qr_code, party_code, party_name, courier_agency_id, boxes')
          .gte('created_at', fromDate.toISOString())
          .lte('created_at', toDate.toISOString()),
        supabase
          .from('flagged_parties')
          .select('party_code')
      ]);

      const flaggedCodes = new Set((flaggedResult.data || []).map(fp => fp.party_code));
      const labelPrints = labelPrintsResult.data || [];

      // Build cache map: QR -> record data
      qrCacheRef.current.clear();

      // Cache parent QR codes
      const labelMap = new Map<string, any>();
      labelPrints.forEach(record => {
        labelMap.set(record.id, record);
        qrCacheRef.current.set(record.qr_code, {
          id: record.id,
          party_code: record.party_code,
          party_name: record.party_name,
          courier_agency_id: record.courier_agency_id,
          boxes: record.boxes,
          scanned_count: 0,
          is_flagged: flaggedCodes.has(record.party_code)
        });
      });

      // Also cache individual box QR codes for multi-box scanning
      if (labelPrints.length > 0) {
        const labelIds = labelPrints.map(lp => lp.id);
        const { data: boxQRCodes, error: boxError } = await supabase
          .from('box_qr_codes')
          .select('id, label_print_id, box_number, qr_code, scanned')
          .in('label_print_id', labelIds);

        if (!boxError && boxQRCodes) {
          // Count scanned boxes per label
          const scannedCountMap = new Map<string, number>();
          boxQRCodes.forEach(box => {
            if (box.scanned) {
              scannedCountMap.set(box.label_print_id, (scannedCountMap.get(box.label_print_id) || 0) + 1);
            }
          });

          // Update scanned_count in parent cache entries
          labelPrints.forEach(record => {
            const cached = qrCacheRef.current.get(record.qr_code);
            if (cached) {
              cached.scanned_count = scannedCountMap.get(record.id) || 0;
            }
          });

          // Cache each box QR code with reference to parent label
          boxQRCodes.forEach(box => {
            const parentLabel = labelMap.get(box.label_print_id);
            if (parentLabel) {
              qrCacheRef.current.set(box.qr_code, {
                id: parentLabel.id,
                party_code: parentLabel.party_code,
                party_name: parentLabel.party_name,
                courier_agency_id: parentLabel.courier_agency_id,
                boxes: parentLabel.boxes,
                scanned_count: scannedCountMap.get(parentLabel.id) || 0,
                is_flagged: flaggedCodes.has(parentLabel.party_code)
              });
            }
          });

          console.log(`QR Cache populated: ${qrCacheRef.current.size} records (including ${boxQRCodes.length} box QR codes)`);
        }
      } else {
        console.log(`QR Cache populated: ${qrCacheRef.current.size} records ready for instant lookup`);
      }
    } catch (error) {
      console.error('Failed to populate QR cache:', error);
    }
  }

  /**
   * Get scan tally records for the selected date range including flagged parties for display
   */
  async function getTodaysScanTallyIncludingFlagged(): Promise<ScanTallyRecord[]> {
    try {
      const fromDate = new Date(dateFrom);
      fromDate.setHours(0, 0, 0, 0);

      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);

      // Get all label prints excluding By-Hand entries
      const { data: labelPrints, error } = await supabase
        .from('label_prints')
        .select('*')
        .gte('created_at', fromDate.toISOString())
        .lte('created_at', toDate.toISOString())
        .order('created_at', { ascending: true });

      if (error) throw error;
      
      // Get flagged parties
      const { data: flaggedParties, error: flaggedError } = await supabase
        .from('flagged_parties')
        .select('party_code');

      if (flaggedError) throw flaggedError;

      const flaggedCodes = new Set((flaggedParties || []).map(fp => fp.party_code));
      
      // Filter out "By-Hand" entries but keep flagged parties for display
      const courierLabels = (labelPrints || []).filter(record => {
        const transportLower = record.transport.toLowerCase();
        return !transportLower.includes('by-hand') && 
               !transportLower.includes('by hand') && 
               !transportLower.includes('byhand');
      });
      
      if (courierLabels.length === 0) {
        return [];
      }
      
      // Get scan counts and box QR codes for all courier labels
      const labelIds = courierLabels.map(record => record.id);
      const [scanCountsResult, boxQRCodesResult] = await Promise.all([
        supabase
          .from('scan_tally')
          .select('label_print_id')
          .in('label_print_id', labelIds),
        supabase
          .from('box_qr_codes')
          .select('label_print_id, box_number, qr_code, scanned')
          .in('label_print_id', labelIds)
          .order('box_number', { ascending: true })
      ]);

      if (scanCountsResult.error) throw scanCountsResult.error;
      if (boxQRCodesResult.error) throw boxQRCodesResult.error;

      const scanCounts = scanCountsResult.data || [];
      const boxQRCodes = boxQRCodesResult.data || [];

      // Count scans per label
      const scanCountMap = scanCounts.reduce((acc, scan) => {
        acc[scan.label_print_id] = (acc[scan.label_print_id] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Build box QR codes map
      const boxQRMap = boxQRCodes.reduce((acc, box) => {
        if (!acc[box.label_print_id]) {
          acc[box.label_print_id] = { scanned: [], pending: [], qr_codes: [] };
        }
        acc[box.label_print_id].qr_codes.push(box.qr_code);
        if (box.scanned) {
          acc[box.label_print_id].scanned.push(box.box_number);
        } else {
          acc[box.label_print_id].pending.push(box.box_number);
        }
        return acc;
      }, {} as Record<string, { scanned: number[], pending: number[], qr_codes: string[] }>);

      // Transform all labels to ScanTallyRecord format
      return courierLabels.map(record => {
        const isFlagged = flaggedCodes.has(record.party_code);
        const boxInfo = boxQRMap[record.id] || { scanned: [], pending: [], qr_codes: [] };
        const scannedCount = isFlagged ? 0 : (boxInfo.scanned.length || scanCountMap[record.id] || 0);
        const isFullyScanned = !isFlagged && scannedCount >= record.boxes;

        return {
          id: record.id,
          qr_code: record.qr_code,
          party_name: record.party_name,
          party_code: record.party_code,
          address: record.address,
          phone_number: record.phone_number,
          bill_numbers: record.bill_numbers,
          boxes: record.boxes,
          scanned_count: scannedCount,
          transport: record.transport,
          courier_agency_id: record.courier_agency_id,
          label_type: record.label_type,
          status: isFlagged ? 'missing' : (isFullyScanned ? 'scanned' : 'missing'),
          scanned_at: record.scanned_at,
          created_at: record.created_at,
          updated_at: record.updated_at,
          is_flagged: isFlagged,
          scanned_boxes: boxInfo.scanned,
          pending_boxes: boxInfo.pending,
          box_qr_codes: boxInfo.qr_codes
        };
      });
    } catch (error) {
      console.error('Error fetching today\'s scan tally:', error);
      throw error;
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

  // Barcode validation function
  function isValidBarcode(barcode: string): boolean {
    const trimmed = barcode.trim();
    
    // Check length
    if (trimmed.length < BARCODE_CONFIG.MIN_LENGTH || trimmed.length > BARCODE_CONFIG.MAX_LENGTH) {
      return false;
    }
    
    // Check regex pattern
    return BARCODE_CONFIG.REGEX.test(trimmed);
  }

  // Auto-submit handler
  async function handleAutoSubmit() {
    const now = Date.now();
    
    // Debounce check - prevent duplicate submissions
    if (now - lastSubmissionTime < BARCODE_CONFIG.DEBOUNCE_WINDOW) {
      console.log('Auto-submit debounced - too soon after last submission');
      return;
    }
    
    if (!barcodeInput.trim() || isSubmitting || isScanning) {
      return;
    }
    
    console.log('Auto-submitting QR code:', barcodeInput.trim());
    setLastSubmissionTime(now);
    
    // Create synthetic form event
    const syntheticEvent = {
      preventDefault: () => {},
      target: { value: barcodeInput.trim() }
    } as unknown as React.FormEvent;

    await handleBarcodeScan(syntheticEvent);
  }

  // Handle manual Enter key press
  function handleBarcodeKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      
      // Clear any pending auto-submit synchronously (ref ensures instant cancellation)
      if (autoSubmitTimeoutRef.current) {
        clearTimeout(autoSubmitTimeoutRef.current);
        autoSubmitTimeoutRef.current = null;
      }
      
      // Submit immediately
      const syntheticEvent = {
        preventDefault: () => {},
        target: { value: barcodeInput.trim() }
      } as unknown as React.FormEvent;

      handleBarcodeScan(syntheticEvent);
    }
  }
  
  // Update single party row from History edit with immediate UI update
  async function updateSinglePartyRowFromHistoryEdit(partyListId: string, updatedData: any) {
    try {
      console.log(`[ScanTally] Updating party row from History edit:`, updatedData);
      
      // Update the specific party's row in UI state immediately
      setScanTallyRecords(prevRecords => 
        prevRecords.map(record => 
          record.id === partyListId 
            ? {
                ...record,
                party_name: updatedData.party_name || record.party_name,
                address: updatedData.address || record.address,
                bill_numbers: updatedData.bill_numbers || record.bill_numbers,
                boxes: updatedData.boxes || record.boxes,
                transport: updatedData.transport || updatedData.courier_agency?.agency_name || record.transport,
                courier_agency_id: updatedData.courier_agency_id || record.courier_agency_id,
                updated_at: new Date().toISOString()
              }
            : record
        )
      );
      
      // Recalculate progress if boxes changed
      if (updatedData.boxes !== undefined) {
        const progressData = await getScanProgress();
        setScanProgress(progressData);
      }
      
      toast.success(`Scan Tally updated: ${updatedData.party_name || 'party'} - boxes=${updatedData.boxes}`);
      console.log(`[ScanTally] Successfully updated party ${updatedData.party_code} from History edit`);
      
    } catch (error) {
      console.error('[ScanTally] Error updating party from History edit:', error);
      // Fallback: reload only this party's data
      await updateSinglePartyRow(partyListId);
    }
  }

  async function updateSinglePartyRow(partyId: string) {
    try {
      // Optimized: Parallel queries for maximum speed
      const [labelResult, scanCountResult, boxQRCodesResult, progressData] = await Promise.all([
        supabase
          .from('label_prints')
          .select('id, qr_code, party_name, party_code, address, phone_number, bill_numbers, boxes, transport, courier_agency_id, label_type, status, scanned_at, created_at, updated_at')
          .eq('id', partyId)
          .single(),
        supabase
          .from('scan_tally')
          .select('*', { count: 'exact', head: true })
          .eq('label_print_id', partyId),
        supabase
          .from('box_qr_codes')
          .select('box_number, qr_code, scanned')
          .eq('label_print_id', partyId)
          .order('box_number', { ascending: true }),
        getScanProgress()
      ]);

      if (labelResult.error) {
        if (labelResult.error.code === 'PGRST116') {
          // Record doesn't exist, remove from list
          setScanTallyRecords(prev => prev.filter(r => r.id !== partyId));
          return;
        }
        throw labelResult.error;
      }

      const labelPrint = labelResult.data;
      const scanCount = scanCountResult.count || 0;
      const boxQRCodes = boxQRCodesResult.data || [];

      // Check if flagged
      const { data: flaggedParty } = await supabase
        .from('flagged_parties')
        .select('party_code')
        .eq('party_code', labelPrint.party_code)
        .maybeSingle();

      const isFlagged = !!flaggedParty;

      // Build box info
      const boxInfo = boxQRCodes.reduce((acc, box) => {
        acc.qr_codes.push(box.qr_code);
        if (box.scanned) {
          acc.scanned.push(box.box_number);
        } else {
          acc.pending.push(box.box_number);
        }
        return acc;
      }, { scanned: [] as number[], pending: [] as number[], qr_codes: [] as string[] });

      const scannedCount = isFlagged ? 0 : (boxInfo.scanned.length || scanCount);
      const isFullyScanned = !isFlagged && scannedCount >= labelPrint.boxes;

      const updatedRecord: ScanTallyRecord = {
        id: labelPrint.id,
        qr_code: labelPrint.qr_code,
        party_name: labelPrint.party_name,
        party_code: labelPrint.party_code,
        address: labelPrint.address,
        phone_number: labelPrint.phone_number,
        bill_numbers: labelPrint.bill_numbers,
        boxes: labelPrint.boxes,
        scanned_count: scannedCount,
        transport: labelPrint.transport,
        courier_agency_id: labelPrint.courier_agency_id,
        label_type: labelPrint.label_type,
        status: isFlagged ? 'missing' : (isFullyScanned ? 'scanned' : 'missing'),
        scanned_at: labelPrint.scanned_at,
        created_at: labelPrint.created_at,
        updated_at: labelPrint.updated_at,
        is_flagged: isFlagged,
        scanned_boxes: boxInfo.scanned,
        pending_boxes: boxInfo.pending,
        box_qr_codes: boxInfo.qr_codes
      };

      // Update the specific record in state
      setScanTallyRecords(prevRecords => {
        const existingIndex = prevRecords.findIndex(r => r.id === partyId);
        if (existingIndex >= 0) {
          const newRecords = [...prevRecords];
          newRecords[existingIndex] = updatedRecord;
          return newRecords;
        } else {
          return [...prevRecords, updatedRecord];
        }
      });

      // Update progress (already fetched in parallel)
      setScanProgress(progressData);

    } catch (error) {
      console.error('Error updating single party row:', error);
      // Fallback to full reload only if single update fails
      await loadScanTallyData();
    }
  }

  function applyFilters() {
    let filtered = [...scanTallyRecords];
    
    // Apply courier filter first
    if (selectedCourierId) {
      filtered = filtered.filter(record => record.courier_agency_id === selectedCourierId);
    }
    
    // Apply status filter
    if (activeStatusFilter !== 'all') {
      filtered = filtered.filter(record => {
        const isFullyScanned = record.scanned_count >= record.boxes;
        const isPartiallyScanned = record.scanned_count > 0 && record.scanned_count < record.boxes;
        
        switch (activeStatusFilter) {
          case 'scanned':
            return isFullyScanned;
          case 'partial':
            return isPartiallyScanned;
          case 'missing':
            // A record is missing if it's not fully or partially scanned. This covers both normal missing and flagged items.
            return !isFullyScanned && !isPartiallyScanned;
          default:
            return true;
        }
      });
    }
    
    // Apply search term filter
    if (!searchTerm.trim()) {
      setFilteredRecords(filtered);
    } else {
      const searchLower = searchTerm.toLowerCase();
      const searchFiltered = filtered.filter(record =>
        record.party_name.toLowerCase().includes(searchLower) ||
        record.party_code.toLowerCase().includes(searchLower) ||
        record.qr_code.toLowerCase().includes(searchLower)
      );
      setFilteredRecords(searchFiltered);
    }
    
    // Recalculate progress based on filtered records
    const filteredProgress = calculateProgressFromRecords(filtered);
    setScanProgress(filteredProgress);
  }
  
  function calculateProgressFromRecords(records: ScanTallyRecord[]): ScanProgress {
    let scanned = 0;
    let partial = 0;
    let missing = 0;
    
    records.forEach(record => {
      const isFullyScanned = record.scanned_count >= record.boxes;
      const isPartiallyScanned = record.scanned_count > 0 && record.scanned_count < record.boxes;
      
      if (isFullyScanned) {
        scanned++;
      } else if (isPartiallyScanned) {
        partial++;
      } else {
        missing++;
      }
    });
    
    const total = records.length;
    const percentage = total > 0 ? (scanned / total) * 100 : 0;
    
    return { total, scanned, missing, partial, percentage };
  }

  async function handleBarcodeScan(e: React.FormEvent) {
    e.preventDefault();

    if (!barcodeInput.trim()) {
      toast.error('Please enter a QR code');
      return;
    }

    // Prevent double submissions
    if (isSubmitting) {
      console.log('Scan already in progress, ignoring duplicate submission');
      return;
    }

    // Minimal debounce check for rapid scanning
    const now = Date.now();
    if (now - lastSubmissionTime < BARCODE_CONFIG.DEBOUNCE_WINDOW) {
      console.log('Scan debounced - too soon after last submission');
      return;
    }

    setLastSubmissionTime(now);
    setIsSubmitting(true);
    setIsScanning(true);

    const scannedQR = barcodeInput.trim();
    const startTime = performance.now();

    // INSTANT FEEDBACK: Show scanning toast immediately
    const scanToastId = toast.loading('Scanning...', {
      duration: Infinity,
      style: {
        background: '#3B82F6',
        color: 'white',
        fontWeight: 'bold',
        fontSize: '16px'
      }
    });

    try {
      // ULTRA-FAST: Check cache first (instant, no database query!)
      const cachedRecord = qrCacheRef.current.get(scannedQR);

      if (!cachedRecord) {
        // CACHE-MISS PATH: Let backend handle all validation
        // No frontend database queries to avoid race conditions

        try {
          // Optional: Check in-memory filters for better UX (non-blocking)
          // Note: These checks are best-effort and may not catch new QRs being generated
          // The backend will do the authoritative validation

          // Check flagged parties from in-memory state
          const flaggedRecord = scanTallyRecords.find(r =>
            r.is_flagged && (r.qr_code === scannedQR || r.box_qr_codes?.includes(scannedQR))
          );

          if (flaggedRecord) {
            toast.dismiss(scanToastId);
            playErrorSound();
            toast.error(`Party ${flaggedRecord.party_name} is flagged`, {
              duration: 3000,
              style: {
                background: '#DC2626',
                color: 'white',
                fontWeight: 'bold',
                fontSize: '16px'
              }
            });
            return;
          }

          // Check courier filter from in-memory state
          if (selectedCourierId) {
            const recordWithWrongCourier = scanTallyRecords.find(r =>
              (r.qr_code === scannedQR || r.box_qr_codes?.includes(scannedQR)) &&
              r.courier_agency_id !== selectedCourierId
            );

            if (recordWithWrongCourier) {
              toast.dismiss(scanToastId);
              playErrorSound();
              const selectedCourier = courierAgencies.find(c => c.id === selectedCourierId);
              toast.error(
                `Wrong courier. Expected: ${selectedCourier?.agency_name || 'Unknown'}`,
                {
                  duration: 3000,
                  style: {
                    background: '#DC2626',
                    color: 'white',
                    fontWeight: 'bold',
                    fontSize: '16px'
                  }
                }
              );
              return;
            }
          }

          // Call backend immediately - it handles all validation
          // Backend will check: QR exists, not already scanned, etc.
          const result = await markBarcodeAsScanned(scannedQR);

          if (!result) {
            toast.dismiss(scanToastId);
            playErrorSound();
            toast.error('Scan failed - no result returned', {
              duration: 3000,
              style: {
                background: '#DC2626',
                color: 'white',
                fontWeight: 'bold',
                fontSize: '16px'
              }
            });
            return;
          }

          // SUCCESS - Show single success message
          toast.dismiss(scanToastId);
          playSuccessSound();

          const boxInfo = result.box_number ? ` (Box ${result.box_number})` : '';
          toast.success(
            `${result.party_name}: ${result.scanned_count}/${result.boxes} scanned${boxInfo}`,
            {
              duration: 2000,
              style: {
                background: '#10B981',
                color: 'white',
                fontWeight: 'bold',
                fontSize: '16px',
                padding: '16px'
              }
            }
          );

          // Update UI with confirmed data
          setScanTallyRecords(prevRecords =>
            prevRecords.map(record =>
              record.id === result.id
                ? { ...record, scanned_count: result.scanned_count, status: 'scanned' as const }
                : record
            )
          );
          setLastScannedId(result.id);

          // Update progress in background
          updateSinglePartyRow(result.id);

          // Emit sync event for other tabs
          emitSyncEvent('update', 'scan_tally', result.id, result, 'scan-tally');

          const totalTime = performance.now() - startTime;
          console.log(`Total scan operation completed in ${totalTime.toFixed(0)}ms`);

        } catch (error) {
          // Backend validation failed OR database error
          toast.dismiss(scanToastId);
          playErrorSound();
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          toast.error(errorMessage, {
            duration: 3000,
            style: {
              background: '#DC2626',
              color: 'white',
              fontWeight: 'bold',
              fontSize: '16px'
            }
          });
        }

        return;
      } else {
        // CACHE-HIT PATH: Use cache only for flagged/courier checks.
        // NEVER use cache to decide "already scanned" — cache can be stale.
        // Always call the backend which is the single source of truth.
        const cacheHitTime = performance.now() - startTime;
        console.log(`⚡ Cache hit in ${cacheHitTime.toFixed(1)}ms`);

        // Instant flagged check from cache (safe — flagged state rarely changes)
        if (cachedRecord.is_flagged) {
          toast.dismiss(scanToastId);
          playErrorSound();
          toast.error(`Party ${cachedRecord.party_name} is flagged`, {
            duration: 2000,
            style: {
              background: '#DC2626',
              color: 'white',
              fontWeight: 'bold',
              fontSize: '16px'
            }
          });
          return;
        }

        // Instant courier check from cache (safe — courier rarely changes)
        if (selectedCourierId && cachedRecord.courier_agency_id !== selectedCourierId) {
          toast.dismiss(scanToastId);
          playErrorSound();
          const selectedCourier = courierAgencies.find(c => c.id === selectedCourierId);
          toast.error(`Wrong courier: ${selectedCourier?.agency_name || 'Unknown'}`, {
            duration: 2000,
            style: {
              background: '#DC2626',
              color: 'white',
              fontWeight: 'bold',
              fontSize: '16px'
            }
          });
          return;
        }

        // Always call backend — it is the only reliable source for scanned state
        try {
          const result = await markBarcodeAsScanned(scannedQR);

          if (!result) {
            toast.dismiss(scanToastId);
            playErrorSound();
            toast.error('Scan failed - no result returned', {
              duration: 3000,
              style: { background: '#DC2626', color: 'white', fontWeight: 'bold', fontSize: '16px' }
            });
            return;
          }

          toast.dismiss(scanToastId);
          playSuccessSound();

          const boxInfo = result.box_number ? ` (Box ${result.box_number})` : '';
          toast.success(
            `${result.party_name}: ${result.scanned_count}/${result.boxes} scanned${boxInfo}`,
            {
              duration: 2000,
              style: { background: '#10B981', color: 'white', fontWeight: 'bold', fontSize: '16px', padding: '16px' }
            }
          );

          // Update UI with confirmed data from backend
          setScanTallyRecords(prevRecords =>
            prevRecords.map(record =>
              record.id === result.id
                ? { ...record, scanned_count: result.scanned_count, status: 'scanned' as const }
                : record
            )
          );
          setLastScannedId(result.id);

          // Sync all sibling QR cache entries with confirmed DB count
          qrCacheRef.current.forEach((entry, key) => {
            if (entry.id === result.id) {
              qrCacheRef.current.set(key, { ...entry, scanned_count: result.scanned_count });
            }
          });

          // Update progress in background
          updateSinglePartyRow(result.id);

          // Emit sync event for other tabs
          emitSyncEvent('update', 'scan_tally', result.id, result, 'scan-tally');

          const totalTime = performance.now() - startTime;
          console.log(`Total scan operation completed in ${totalTime.toFixed(0)}ms`);

        } catch (error) {
          toast.dismiss(scanToastId);
          playErrorSound();
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          toast.error(errorMessage, {
            duration: 3000,
            style: { background: '#DC2626', color: 'white', fontWeight: 'bold', fontSize: '16px' }
          });
        }
      }

    } catch (error) {
      toast.dismiss(scanToastId);
      playErrorSound();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(errorMessage, {
        duration: 4000,
        style: {
          background: '#DC2626',
          color: 'white',
          fontWeight: 'bold',
          fontSize: '16px'
        }
      });
    } finally {
      // Clear input and re-focus for continuous scanning
      setBarcodeInput('');
      setIsScanning(false);
      setIsSubmitting(false);
      
      // Clear any pending auto-submit synchronously
      if (autoSubmitTimeoutRef.current) {
        clearTimeout(autoSubmitTimeoutRef.current);
        autoSubmitTimeoutRef.current = null;
      }
      
      // Auto-focus for continuous scanning (hands-free operation) - instant
      if (barcodeInputRef.current) {
        barcodeInputRef.current.focus();
      }
    }
  }

  function handleStatusCardClick(status: StatusFilter) {
    if (activeStatusFilter === status) {
      // Toggle off if already active
      setActiveStatusFilter('all');
      toast.success('Status filter cleared');
    } else {
      setActiveStatusFilter(status);
      const statusName = status.charAt(0).toUpperCase() + status.slice(1);
      toast.success(`Filtered to ${statusName} entries`);
    }
  }
  
  function clearAllFilters() {
    setSearchTerm('');
    setActiveStatusFilter('all');
    setSelectedCourierId('');
    toast.success('All filters cleared');
  }
  
  function hasActiveFilters(): boolean {
    return searchTerm.trim() !== '' || activeStatusFilter !== 'all' || selectedCourierId !== '';
  }

  async function handleRevertAll() {
    const confirmed = await openConfirmDialog({
      title: 'Revert All Scanned Entries',
      message: 'Are you sure you want to revert ALL scanned entries back to missing status? This action cannot be undone.',
      confirmText: 'Revert All',
      cancelText: 'Cancel',
      variant: 'danger'
    });
    
    if (!confirmed) return;

    setIsReverting(true);
    toast.loading('Reverting all scanned entries...', { id: 'revert-all' });
    
    try {
      const revertedCount = await revertAllScannedEntries();
      
      // Immediately update UI state without full reload
      setScanTallyRecords(prevRecords => 
        prevRecords.map(record => ({
          ...record,
          status: 'missing',
          scanned_count: 0,
          scanned_at: null
        }))
      );
      
      // Recalculate progress based on current filters
      const updatedRecords = scanTallyRecords.map(record => ({
        ...record,
        status: 'missing' as const,
        scanned_count: 0,
        scanned_at: null
      }));
      
      let filteredForProgress = updatedRecords;
      if (selectedCourierId) {
        filteredForProgress = filteredForProgress.filter(record => record.courier_agency_id === selectedCourierId);
      }
      
      const newProgress = calculateProgressFromRecords(filteredForProgress);
      setScanProgress(newProgress);
      
      toast.success(`Successfully reverted ${revertedCount} scanned entries`, { id: 'revert-all' });
      
      // Emit sync event for other tabs
      emitSyncEvent('update', 'scan_tally', 'all', { reverted: revertedCount }, 'scan-tally');
      
    } catch (error) {
      const errorMessage = handleSupabaseError(error);
      toast.error(`Failed to revert entries: ${errorMessage}`, { id: 'revert-all' });
      
      // Fallback: reload data if revert fails
      await loadScanTallyData();
    } finally {
      setIsReverting(false);
    }
  }

  async function handleRefresh() {
    try {
      await loadScanTallyData();
      toast.success('Scan tally refreshed successfully');
    } catch (error) {
      toast.error('Failed to refresh scan tally');
    }
  }

  function clearSearch() {
    setSearchTerm('');
    toast.success('Search cleared');
  }

  const selectedCourier = courierAgencies.find(c => c.id === selectedCourierId);

  return (
    <div className="rounded-xl border border-gray-200 shadow-sm bg-white overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Scan className="w-4 h-4 text-green-600" />
            Scan Tally
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {filteredRecords.length} entries shown
            {activeStatusFilter !== 'all' && <span className="ml-1">• {activeStatusFilter}</span>}
            {selectedCourier && <span className="ml-1">• {selectedCourier.agency_name}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            className="p-1.5 rounded border border-gray-200 hover:bg-gray-50"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4 text-gray-600" />
          </button>
          <button
            onClick={handleRevertAll}
            disabled={isReverting || scanProgress.scanned === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {isReverting ? 'Reverting...' : 'Revert All'}
          </button>
        </div>
      </div>

      {/* Scanner + Toolbar row */}
      <div className="px-6 py-3 border-b border-gray-100 bg-gray-50/50 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[minmax(320px,1.45fr)_minmax(280px,0.95fr)_minmax(190px,0.75fr)_minmax(220px,0.9fr)_auto_auto] items-center gap-3">
        {/* QR Scanner input */}
        <form onSubmit={handleBarcodeScan} className="flex items-center gap-2 w-full min-w-0">
          <div className="relative flex-1 min-w-0">
            <Scan className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-green-500 pointer-events-none" />
            <input
              ref={barcodeInputRef}
              type="text"
              value={barcodeInput}
              onChange={(e) => {
                const value = e.target.value;
                setBarcodeInput(value);
                if (autoSubmitTimeoutRef.current) {
                  clearTimeout(autoSubmitTimeoutRef.current);
                  autoSubmitTimeoutRef.current = null;
                }
              }}
              onKeyDown={handleBarcodeKeyDown}
              placeholder={selectedCourier ? `Scan for ${selectedCourier.agency_name}…` : 'Scan QR code…'}
              className="h-9 w-full pl-9 pr-3 text-sm text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              disabled={isScanning || isSubmitting}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <button
            type="submit"
            disabled={isScanning || isSubmitting || !barcodeInput.trim()}
            className="h-9 flex items-center gap-1.5 px-3 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            {isScanning || isSubmitting ? (
              <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></div>
            ) : (
              <Scan className="w-3.5 h-3.5" />
            )}
            {isScanning || isSubmitting ? 'Scanning…' : 'Scan'}
          </button>
        </form>

        {/* Date range */}
        <div className="flex items-center gap-2 w-full min-w-0">
          <Clock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            max={dateTo}
            className="h-9 min-w-0 flex-1 px-2 text-sm text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-xs text-gray-400">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            min={dateFrom}
            className="h-9 min-w-0 flex-1 px-2 text-sm text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Courier filter */}
        <select
          value={selectedCourierId}
          onChange={(e) => {
            setSelectedCourierId(e.target.value);
            if (e.target.value) {
              const courier = courierAgencies.find(c => c.id === e.target.value);
              toast.success(`Filtered to ${courier?.agency_name || 'selected courier'}`);
            } else {
              toast.success('Showing all couriers');
            }
          }}
          className="h-9 w-full min-w-0 px-3 text-sm text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Couriers</option>
          {courierAgencies.map((agency) => (
            <option key={agency.id} value={agency.id}>
              {agency.agency_name}
            </option>
          ))}
        </select>

        {/* Search */}
        <div className="relative w-full min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search entries…"
            className="h-9 w-full pl-9 pr-8 text-sm text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {searchTerm && (
            <button onClick={clearSearch} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {hasActiveFilters() && (
          <button onClick={clearAllFilters} className="text-xs text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap">
            Clear filters
          </button>
        )}

        {/* Auto-submit indicator */}
        {barcodeInput.trim() && isValidBarcode(barcodeInput.trim()) && !isSubmitting && (
          <div className="flex items-center gap-1 text-xs text-green-600">
            <div className="animate-pulse w-2 h-2 bg-green-500 rounded-full"></div>
            Auto-scan…
          </div>
        )}
      </div>

      {/* Progress Cards */}
      <div className="px-6 py-4 border-b border-gray-100 grid grid-cols-5 gap-3">
        {[
          { key: 'all' as StatusFilter, label: 'Total', value: scanProgress.total, color: 'blue' },
          { key: 'scanned' as StatusFilter, label: 'Scanned', value: scanProgress.scanned, color: 'green' },
          { key: 'partial' as StatusFilter, label: 'Partial', value: scanProgress.partial, color: 'yellow' },
          { key: 'missing' as StatusFilter, label: 'Missing', value: scanProgress.missing, color: 'red' },
        ].map(({ key, label, value, color }) => (
          <div
            key={key}
            onClick={() => handleStatusCardClick(key)}
            className={`p-3 rounded-lg border cursor-pointer transition-all hover:shadow-sm ${
              activeStatusFilter === key
                ? `bg-${color}-100 border-${color}-300`
                : `bg-${color}-50 border-${color}-200 hover:bg-${color}-100`
            }`}
          >
            <div className={`text-xl font-bold text-${color}-900`}>{value}</div>
            <div className={`text-xs text-${color}-600`}>
              {label}{activeStatusFilter === key && ' ✓'}
            </div>
          </div>
        ))}
        <div className="p-3 rounded-lg border bg-purple-50 border-purple-200">
          <div className="text-xl font-bold text-purple-900">{scanProgress.percentage.toFixed(1)}%</div>
          <div className="text-xs text-purple-600">Complete</div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">S.No</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">QR Code</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Party</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Address</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Bills</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Scan Progress</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Transport</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Scanned At</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-6 py-12 text-center">
                  <LoadingSpinner size="sm" message="Loading scan tally data..." />
                </td>
              </tr>
            ) : filteredRecords.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-12 text-center">
                  <Package className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                  <p className="text-sm font-medium text-gray-600">
                    {searchTerm
                      ? `No entries matching "${searchTerm}"`
                      : selectedCourier
                      ? `No entries for ${selectedCourier.agency_name}`
                      : activeStatusFilter !== 'all'
                      ? `No ${activeStatusFilter} entries`
                      : 'No data found'}
                  </p>
                </td>
              </tr>
            ) : (
              filteredRecords.map((record, index) => {
                const isHighlighted = lastScannedId === record.id;
                const isFullyScanned = record.scanned_count >= record.boxes;
                const isPartiallyScanned = record.scanned_count > 0 && record.scanned_count < record.boxes;
                const isFlagged = record.is_flagged ?? false;

                return (
                  <tr
                    key={record.id}
                    className={`transition-colors ${
                      isHighlighted ? 'bg-green-100 border-l-4 border-green-500' :
                      isFullyScanned ? 'bg-green-50 hover:bg-gray-50' :
                      isPartiallyScanned ? 'bg-yellow-50 hover:bg-gray-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-gray-800 whitespace-nowrap">{index + 1}</td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-700">
                      {record.box_qr_codes && record.box_qr_codes.length > 0 ? (
                        <div className="flex flex-col gap-0.5">
                          {record.box_qr_codes.map((qr, idx) => <div key={idx}>{qr}</div>)}
                        </div>
                      ) : (
                        record.qr_code
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-800">
                      <div className="flex items-center gap-1.5">
                        {isFlagged && <span title="Flagged — cannot be scanned"><Flag className="w-3.5 h-3.5 text-red-600 flex-shrink-0" /></span>}
                        <div>
                          <p className="font-medium">{record.party_name}</p>
                          <p className="text-xs text-gray-500">Code: {record.party_code}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      <div>{record.address}</div>
                      {record.phone_number && (
                        <div className="text-xs text-gray-500 mt-0.5">📞 {record.phone_number}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      <div className="flex flex-wrap gap-1">
                        {record.bill_numbers.slice(0, 3).map((bill, idx) => (
                          <span key={idx} className="inline-block bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded text-xs text-gray-700">
                            {bill}
                          </span>
                        ))}
                        {record.bill_numbers.length > 3 && (
                          <span className="text-xs text-gray-400">+{record.bill_numbers.length - 3} more</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full transition-all ${
                                isFullyScanned ? 'bg-green-500' : isPartiallyScanned ? 'bg-yellow-500' : 'bg-gray-300'
                              }`}
                              style={{ width: `${(record.scanned_count / record.boxes) * 100}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium text-gray-700">{record.scanned_count}/{record.boxes}</span>
                        </div>
                        {record.scanned_boxes && record.scanned_boxes.length > 0 && (
                          <div className="text-xs text-gray-500">
                            <span className="text-green-600 font-medium">Scanned: </span>
                            {record.scanned_boxes.join(', ')}
                          </div>
                        )}
                        {record.pending_boxes && record.pending_boxes.length > 0 && (
                          <div className="text-xs text-gray-500">
                            <span className="text-red-600 font-medium">Pending: </span>
                            {record.pending_boxes.join(', ')}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{record.transport}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        isFullyScanned
                          ? 'bg-green-100 text-green-800'
                          : isPartiallyScanned
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {isFullyScanned ? (
                          <><CheckCircle className="w-3 h-3" />Scanned</>
                        ) : isPartiallyScanned ? (
                          <><Clock className="w-3 h-3" />Partial</>
                        ) : (
                          <><AlertTriangle className="w-3 h-3" />Missing</>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                      {record.scanned_at ? formatTime(new Date(record.scanned_at)) : '-'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
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
