
// import { supabase, handleSupabaseError } from './supabase';
// import { format } from 'date-fns';

// export interface BoxQRCode {
//   id: string;
//   label_print_id: string;
//   box_number: number;
//   qr_code: string;
//   scanned: boolean;
//   scanned_at: string | null;
//   created_at: string;
// }

// export interface LabelPrintRecord {
//   id: string;
//   party_list_id: string;
//   qr_code: string;
//   party_name: string;
//   party_code: string;
//   address: string;
//   phone_number?: string | null;
//   bill_numbers: string[];
//   boxes: number;
//   transport: string;
//   courier_agency_id: string | null;
//   label_type: 'courier' | 'byhand';
//   status: 'missing' | 'scanned';
//   scanned_at: string | null;
//   is_printed: boolean;
//   printed_at: string | null;
//   created_at: string;
//   updated_at: string;
//   box_qr_codes?: BoxQRCode[];
// }

// export interface ScanTallyRecord {
//   id: string;
//   qr_code: string;
//   party_name: string;
//   party_code: string;
//   address: string;
//   phone_number?: string | null;
//   bill_numbers: string[];
//   boxes: number;
//   scanned_count: number;
//   transport: string;
//   courier_agency_id: string | null;
//   label_type: 'courier' | 'byhand';
//   status: 'missing' | 'scanned';
//   scanned_at: string | null;
//   created_at: string;
//   updated_at: string;
//   is_flagged?: boolean;
//   scanned_boxes?: number[];
//   pending_boxes?: number[];
//   box_qr_codes?: string[];
// }

// export interface PartyListEntry {
//   id: string;
//   date: string;
//   party_code: string;
//   bill_numbers: string[];
//   boxes: number;
//   courier_agency_id: string;
//   serialNumber: number;
//   party_info: {
//     party_name: string;
//     address: string;
//     phone_number?: string;
//   };
//   courier_agency: {
//     agency_name: string;
//   };
// }


// // *** START OF FIX 1 ***
// // The old, sequential generateQRCode function has been completely removed.
// // It is no longer exported or available to any part of the application.

// /**
//  * Determine label type based on courier agency name
//  */
// export function determineLabelType(courierName: string): 'courier' | 'byhand' {
//   const normalizedName = (courierName || '').toLowerCase();
//   const isByHand = normalizedName.includes('by-hand') ||
//                    normalizedName.includes('by hand') ||
//                    normalizedName.includes('byhand');
//   return isByHand ? 'byhand' : 'courier';
// }

// /**
//  * Generate unique QR codes for each box in a shipment
//  */
// async function generateBoxQRCodes(
//   labelPrintId: string,
//   boxCount: number
// ): Promise<BoxQRCode[]> {
//   try {
//     console.log(`[generateBoxQRCodes] Starting for label ${labelPrintId}, count: ${boxCount}`);
//     const baseId = Math.random().toString(36).substring(2, 8).toUpperCase();
//     const datePrefix = format(new Date(), 'yyMMdd');
//     console.log(`[generateBoxQRCodes] Base ID: ${baseId}, Date prefix: ${datePrefix}`);

//     const boxQRData = [];
//     for (let boxNum = 1; boxNum <= boxCount; boxNum++) {
//       const qrCode = `DS${datePrefix}${baseId}-B${boxNum}`;
//       boxQRData.push({
//         label_print_id: labelPrintId,
//         box_number: boxNum,
//         qr_code: qrCode,
//         scanned: false
//       });
//     }
//     console.log(`[generateBoxQRCodes] Prepared ${boxQRData.length} QR codes`);

//     console.log(`[generateBoxQRCodes] Inserting into database...`);
//     const { data, error } = await supabase
//       .from('box_qr_codes')
//       .insert(boxQRData)
//       .select();

//     if (error) {
//       console.error('[generateBoxQRCodes] Database error:', error);
//       throw new Error(`Database insert failed: ${error.message} (${error.code})`);
//     }

//     console.log(`[generateBoxQRCodes] Success! Generated ${data?.length || 0} QR codes`);
//     return (data || []) as BoxQRCode[];
//   } catch (error) {
//     console.error('[generateBoxQRCodes] Error:', error);
//     if (error instanceof Error) {
//       throw new Error(`QR code generation failed: ${error.message}`);
//     }
//     throw new Error('QR code generation failed: Unknown error');
//   }
// }

// /**
//  * Get box QR codes for a label print record
//  */
// export async function getBoxQRCodes(labelPrintId: string): Promise<BoxQRCode[]> {
//   try {
//     const { data, error } = await supabase
//       .from('box_qr_codes')
//       .select('*')
//       .eq('label_print_id', labelPrintId)
//       .order('box_number', { ascending: true });

//     if (error) throw error;
//     return (data || []) as BoxQRCode[];
//   } catch (error) {
//     console.error('Error fetching box QR codes:', error);
//     throw error;
//   }
// }

// /**
//  * Get or generate box QR codes for a label print record
//  * This function ensures box QR codes exist, generating them if missing
//  */
// export async function getOrGenerateBoxQRCodes(labelPrintId: string, boxCount: number): Promise<BoxQRCode[]> {
//   try {
//     console.log(`[getOrGenerateBoxQRCodes] Starting for label ${labelPrintId}, boxCount: ${boxCount}`);

//     let boxQRCodes = await getBoxQRCodes(labelPrintId);
//     console.log(`[getOrGenerateBoxQRCodes] Found ${boxQRCodes.length} existing QR codes`);

//     if (boxQRCodes.length === 0 || boxQRCodes.length !== boxCount) {
//       console.log(`[getOrGenerateBoxQRCodes] Generating missing box QR codes (found ${boxQRCodes.length}, need ${boxCount})`);

//       if (boxQRCodes.length > 0) {
//         console.log(`[getOrGenerateBoxQRCodes] Deleting incomplete QR codes`);
//         const { error: deleteError } = await supabase
//           .from('box_qr_codes')
//           .delete()
//           .eq('label_print_id', labelPrintId);

//         if (deleteError) {
//           console.error('[getOrGenerateBoxQRCodes] Error deleting incomplete box QR codes:', deleteError);
//           throw new Error(`Failed to delete incomplete QR codes: ${deleteError.message}`);
//         }
//       }

//       console.log(`[getOrGenerateBoxQRCodes] Calling generateBoxQRCodes`);
//       boxQRCodes = await generateBoxQRCodes(labelPrintId, boxCount);
//       console.log(`[getOrGenerateBoxQRCodes] Generated ${boxQRCodes.length} QR codes`);
//     }

//     return boxQRCodes;
//   } catch (error) {
//     console.error('[getOrGenerateBoxQRCodes] Error:', error);
//     if (error instanceof Error) {
//       throw new Error(`QR code generation failed: ${error.message}`);
//     }
//     throw new Error('QR code generation failed: Unknown error');
//   }
// }

// /**
//  * Create a single label print record. Now generates its own safe QR code.
//  */
// export async function createLabelPrintRecord(
//   partyEntry: PartyListEntry // The unsafe qrCode argument has been removed
// ): Promise<LabelPrintRecord | null> {
//   try {
//     const labelType = determineLabelType(partyEntry.courier_agency?.agency_name || '');

//     // Check if label already exists for this party_list_id
//     const { data: existingLabel, error: checkError } = await supabase
//       .from('label_prints')
//       .select('id')
//       .eq('party_list_id', partyEntry.id)
//       .maybeSingle();

//     if (checkError) throw checkError;

//     if (existingLabel) {
//       console.log(`Label already exists for party ${partyEntry.party_code}`);
//       return null;
//     }
    
//     // Generate a safe, random QR code internally
//     const uniqueId = Math.random().toString(36).substring(2, 8).toUpperCase();
//     const qrCode = `DS${format(new Date(), 'yyMMdd')}${uniqueId}`;

//     const labelPrintData = {
//       party_list_id: partyEntry.id,
//       qr_code: qrCode, // Use the safe, internally generated code
//       party_name: partyEntry.party_info?.party_name || 'Unknown Party',
//       party_code: partyEntry.party_code,
//       address: partyEntry.party_info?.address || 'Unknown Address',
//       phone_number: partyEntry.party_info?.phone_number || null,
//       bill_numbers: partyEntry.bill_numbers || [],
//       boxes: partyEntry.boxes,
//       transport: partyEntry.courier_agency?.agency_name || 'Unknown Transport',
//       courier_agency_id: partyEntry.courier_agency_id,
//       label_type: labelType,
//       status: 'missing'
//     };

//     const { data: labelPrint, error: labelError } = await supabase
//       .from('label_prints')
//       .insert([labelPrintData])
//       .select()
//       .single();

//     if (labelError) throw labelError;

//     await generateBoxQRCodes(labelPrint.id, partyEntry.boxes);

//     return labelPrint as LabelPrintRecord;
//   } catch (error) {
//     console.error('Error creating label print record:', error);
//     throw error;
//   }
// }
// // *** END OF FIX 1 ***

// /**
//  * Update an existing label print record with merged bill numbers and boxes.
//  * This is called when bills are merged into an existing party entry.
//  */
// export async function updateLabelPrintRecord(
//   partyEntry: PartyListEntry
// ): Promise<LabelPrintRecord | null> {
//   try {
//     const labelType = determineLabelType(partyEntry.courier_agency?.agency_name || '');

//     // Find existing label for this party_list_id
//     const { data: existingLabel, error: checkError } = await supabase
//       .from('label_prints')
//       .select('*')
//       .eq('party_list_id', partyEntry.id)
//       .maybeSingle();

//     if (checkError) throw checkError;

//     if (!existingLabel) {
//       // Label doesn't exist, create it instead
//       console.log(`Label not found for party ${partyEntry.party_code}, creating new one`);
//       return await createLabelPrintRecord(partyEntry);
//     }

//     // Update existing label with merged data
//     const { data: updatedLabel, error: updateError } = await supabase
//       .from('label_prints')
//       .update({
//         bill_numbers: partyEntry.bill_numbers || [],
//         boxes: partyEntry.boxes,
//         transport: partyEntry.courier_agency?.agency_name || 'Unknown Transport',
//         courier_agency_id: partyEntry.courier_agency_id,
//         label_type: labelType,
//         updated_at: new Date().toISOString()
//       })
//       .eq('id', existingLabel.id)
//       .select()
//       .single();

//     if (updateError) throw updateError;

//     if (existingLabel.boxes !== partyEntry.boxes) {
//       const { error: deleteError } = await supabase
//         .from('box_qr_codes')
//         .delete()
//         .eq('label_print_id', existingLabel.id);

//       if (deleteError) {
//         console.error('Error deleting old box QR codes:', deleteError);
//       } else {
//         await generateBoxQRCodes(existingLabel.id, partyEntry.boxes);
//       }
//     }

//     console.log(`Updated label for party ${partyEntry.party_code} with ${partyEntry.bill_numbers.length} bills and ${partyEntry.boxes} boxes`);
//     return updatedLabel as LabelPrintRecord;
//   } catch (error) {
//     console.error('Error updating label print record:', error);
//     throw error;
//   }
// }

// /**
//  * Batch create label print records for multiple party entries.
//  * (This function is already correct from our previous fix).
//  */
// export async function batchCreateLabelPrintRecords(
//   partyEntries: PartyListEntry[]
// ): Promise<{ labelPrints: LabelPrintRecord[] }> {
//   try {
//     if (partyEntries.length === 0) return { labelPrints: [] };

//     const labelPrintData = partyEntries.map((entry) => {
//       const uniqueId = Math.random().toString(36).substring(2, 8).toUpperCase();
//       const qrCode = `DS${format(new Date(), 'yyMMdd')}${uniqueId}`;
//       const labelType = determineLabelType(entry.courier_agency?.agency_name || '');

//       return {
//         party_list_id: entry.id,
//         qr_code: qrCode,
//         party_name: entry.party_info?.party_name || 'Unknown Party',
//         party_code: entry.party_code,
//         address: entry.party_info?.address || 'Unknown Address',
//         phone_number: entry.party_info?.phone_number || null,
//         bill_numbers: entry.bill_numbers || [],
//         boxes: entry.boxes,
//         transport: entry.courier_agency?.agency_name || 'Unknown Transport',
//         courier_agency_id: entry.courier_agency_id,
//         label_type: labelType,
//         status: 'missing'
//       };
//     });

//     const { data: labelPrints, error: labelError } = await supabase
//       .from('label_prints')
//       .insert(labelPrintData)
//       .select();

//     if (labelError) throw labelError;

//     const createdLabels = (labelPrints || []) as LabelPrintRecord[];

//     for (const label of createdLabels) {
//       await generateBoxQRCodes(label.id, label.boxes);
//     }

//     return { labelPrints: createdLabels };
//   } catch (error) {
//     console.error('Error batch creating label print records:', error);
//     throw error;
//   }
// }

// // NOTE: The rest of the file is unchanged.

// /**
//  * (Legacy) Get today's label print records by created_at day-window.
//  * Kept for compatibility; prefer getLabelPrintsByPartyIds for exact matching.
//  */
// export async function getTodaysLabelPrints(): Promise<LabelPrintRecord[]> {
//   try {
//     const today = new Date();
//     today.setHours(0, 0, 0, 0);

//     const tomorrow = new Date(today);
//     tomorrow.setDate(tomorrow.getDate() + 1);

//     const { data, error } = await supabase
//       .from('label_prints')
//       .select('*')
//       .gte('created_at', today.toISOString())
//       .lt('created_at', tomorrow.toISOString())
//       .order('created_at', { ascending: true });

//     if (error) throw error;
//     return (data || []) as LabelPrintRecord[];
//   } catch (error) {
//     console.error("Error fetching today's label prints:", error);
//     throw error;
//   }
// }

// /**
//  * Exact: fetch label_prints for a given set of party_list ids.
//  * Use this to align with today's party_list irrespective of when labels were created.
//  */
// export async function getLabelPrintsByPartyIds(
//   partyListIds: string[]
// ): Promise<LabelPrintRecord[]> {
//   try {
//     if (partyListIds.length === 0) return [];

//     const { data, error } = await supabase
//       .from('label_prints')
//       .select('*')
//       .in('party_list_id', partyListIds)
//       .order('created_at', { ascending: true });

//     if (error) throw error;
//     return (data || []) as LabelPrintRecord[];
//   } catch (error) {
//     console.error('Error fetching label prints by party ids:', error);
//     throw error;
//   }
// }

// /**
//  * Get today's scan tally records from label_prints table (couriers-only)
//  */
// export async function getTodaysScanTally(): Promise<ScanTallyRecord[]> {
//   try {
//     const today = new Date();
//     today.setHours(0, 0, 0, 0);

//     const tomorrow = new Date(today);
//     tomorrow.setDate(tomorrow.getDate() + 1);

//     const { data: labelPrints, error } = await supabase
//       .from('label_prints')
//       .select('*')
//       .gte('created_at', today.toISOString())
//       .lt('created_at', tomorrow.toISOString())
//       .order('created_at', { ascending: true });

//     if (error) throw error;

//     const courierLabels = (labelPrints || []).filter((record: any) => {
//       const t = (record.transport || '').toLowerCase();
//       return !t.includes('by-hand') && !t.includes('by hand') && !t.includes('byhand');
//     });

//     if (courierLabels.length === 0) {
//       return [];
//     }

//     const labelIds = courierLabels.map((record: any) => record.id);

//     const { data: boxQRCodes, error: boxError } = await supabase
//       .from('box_qr_codes')
//       .select('label_print_id, box_number, qr_code, scanned')
//       .in('label_print_id', labelIds)
//       .order('box_number', { ascending: true });

//     if (boxError) throw boxError;

//     const boxScanMap = (boxQRCodes || []).reduce((acc: Record<string, { scanned: number[], pending: number[], qr_codes: string[] }>, box: any) => {
//       if (!acc[box.label_print_id]) {
//         acc[box.label_print_id] = { scanned: [], pending: [], qr_codes: [] };
//       }
//       acc[box.label_print_id].qr_codes.push(box.qr_code);
//       if (box.scanned) {
//         acc[box.label_print_id].scanned.push(box.box_number);
//       } else {
//         acc[box.label_print_id].pending.push(box.box_number);
//       }
//       return acc;
//     }, {});

//     return courierLabels.map((record: any) => {
//       const boxInfo = boxScanMap[record.id] || { scanned: [], pending: [], qr_codes: [] };
//       const scannedCount = boxInfo.scanned.length;
//       const isFullyScanned = scannedCount >= record.boxes;

//       return {
//         id: record.id,
//         qr_code: record.qr_code,
//         party_name: record.party_name,
//         party_code: record.party_code,
//         address: record.address,
//         phone_number: record.phone_number,
//         bill_numbers: record.bill_numbers,
//         boxes: record.boxes,
//         scanned_count: scannedCount,
//         transport: record.transport,
//         courier_agency_id: record.courier_agency_id,
//         label_type: record.label_type,
//         status: isFullyScanned ? 'scanned' : 'missing',
//         scanned_at: record.scanned_at,
//         created_at: record.created_at,
//         updated_at: record.updated_at,
//         scanned_boxes: boxInfo.scanned,
//         pending_boxes: boxInfo.pending,
//         box_qr_codes: boxInfo.qr_codes
//       } as ScanTallyRecord;
//     });
//   } catch (error) {
//     console.error("Error fetching today's scan tally:", error);
//     throw error;
//   }
// }

// /**
//  * Mark barcode as scanned by inserting into scan_tally event log
//  * Supports both box-specific QR codes (DS...-B1) and parent label QR codes (DS...)
//  * Optimized for speed with parallel queries
//  */
// export async function markBarcodeAsScanned(qrCode: string): Promise<{
//   party_name: string;
//   scanned_count: number;
//   boxes: number;
//   id: string;
//   box_number?: number;
// } | null> {
//   try {
//     const timestamp = new Date().toISOString();

//     // PARALLEL: Check both box QR and parent label QR simultaneously
//     const [boxResult, labelResult] = await Promise.all([
//       supabase
//         .from('box_qr_codes')
//         .select('id, label_print_id, box_number, scanned')
//         .eq('qr_code', qrCode)
//         .maybeSingle(),
//       supabase
//         .from('label_prints')
//         .select('id, party_name, party_code, boxes')
//         .eq('qr_code', qrCode)
//         .maybeSingle()
//     ]);

//     if (boxResult.error) throw boxResult.error;
//     if (labelResult.error) throw labelResult.error;

//     let labelPrintId: string;
//     let boxToScan: { id: string; box_number: number } | null = null;
//     let labelPrint: any;

//     if (boxResult.data) {
//       // Found as box-specific QR code
//       if (boxResult.data.scanned) {
//         // Fetch label for error message only if needed
//         const { data: labelInfo } = await supabase
//           .from('label_prints')
//           .select('party_name')
//           .eq('id', boxResult.data.label_print_id)
//           .single();
//         throw new Error(`Box ${boxResult.data.box_number} already scanned for ${labelInfo?.party_name || 'this party'}`);
//       }

//       labelPrintId = boxResult.data.label_print_id;
//       boxToScan = { id: boxResult.data.id, box_number: boxResult.data.box_number };

//       // Get label print info
//       const { data: labelInfo, error: labelError } = await supabase
//         .from('label_prints')
//         .select('id, party_name, party_code, boxes')
//         .eq('id', labelPrintId)
//         .single();

//       if (labelError) throw labelError;
//       labelPrint = labelInfo;

//     } else if (labelResult.data) {
//       // Found as parent label QR code
//       labelPrint = labelResult.data;
//       labelPrintId = labelPrint.id;

//       // Find first unscanned box
//       const { data: unscannedBox, error: unscannedError } = await supabase
//         .from('box_qr_codes')
//         .select('id, box_number')
//         .eq('label_print_id', labelPrintId)
//         .eq('scanned', false)
//         .order('box_number', { ascending: true })
//         .limit(1)
//         .maybeSingle();

//       if (unscannedError) throw unscannedError;
//       if (!unscannedBox) {
//         throw new Error(`All boxes already scanned for ${labelPrint.party_name}`);
//       }

//       boxToScan = { id: unscannedBox.id, box_number: unscannedBox.box_number };
//     } else {
//       throw new Error(`Barcode ${qrCode} not found in today's entries`);
//     }

//     // PARALLEL: Get scanned count, update box, and insert scan event simultaneously
//     const [scannedBoxesResult, updateBoxResult, insertScanResult] = await Promise.all([
//       supabase
//         .from('box_qr_codes')
//         .select('id', { count: 'exact' })
//         .eq('label_print_id', labelPrintId)
//         .eq('scanned', true),
//       supabase
//         .from('box_qr_codes')
//         .update({
//           scanned: true,
//           scanned_at: timestamp
//         })
//         .eq('id', boxToScan.id),
//       supabase
//         .from('scan_tally')
//         .insert([{
//           label_print_id: labelPrint.id,
//           qr_code: qrCode,
//           status: 'scanned',
//           scanned_at: timestamp
//         }])
//     ]);

//     if (scannedBoxesResult.error) throw scannedBoxesResult.error;
//     if (updateBoxResult.error) throw updateBoxResult.error;
//     if (insertScanResult.error) throw insertScanResult.error;

//     const currentScannedCount = scannedBoxesResult.data?.length || 0;
//     const newScannedCount = currentScannedCount + 1;

//     // Background: Update label_prints status if fully scanned (non-blocking)
//     if (newScannedCount >= labelPrint.boxes) {
//       supabase
//         .from('label_prints')
//         .update({
//           status: 'scanned',
//           scanned_at: timestamp
//         })
//         .eq('id', labelPrint.id)
//         .then(({ error }) => {
//           if (error) console.error('Error updating label_prints status:', error);
//         });
//     }

//     return {
//       party_name: labelPrint.party_name,
//       scanned_count: newScannedCount,
//       boxes: labelPrint.boxes,
//       id: labelPrint.id,
//       box_number: boxToScan.box_number
//     };
//   } catch (error) {
//     console.error('Error marking barcode as scanned:', error);
//     throw error;
//   }
// }

// /**
//  * Get scan progress statistics (couriers-only)
//  */
// export async function getScanProgress(fromDate?: string, toDate?: string): Promise<{
//   total: number;
//   scanned: number;
//   missing: number;
//   partial: number;
//   percentage: number;
// }> {
//   try {
//     let startDate: Date;
//     let endDate: Date;

//     if (fromDate && toDate) {
//       startDate = new Date(fromDate);
//       startDate.setHours(0, 0, 0, 0);

//       endDate = new Date(toDate);
//       endDate.setHours(23, 59, 59, 999);
//     } else {
//       startDate = new Date();
//       startDate.setHours(0, 0, 0, 0);

//       endDate = new Date(startDate);
//       endDate.setDate(endDate.getDate() + 1);
//     }

//     const { data: labelPrints, error } = await supabase
//       .from('label_prints')
//       .select('id, boxes, transport')
//       .gte('created_at', startDate.toISOString())
//       .lte('created_at', endDate.toISOString());

//     if (error) throw error;

//     const courierLabels = (labelPrints || []).filter((record: any) => {
//       const t = (record.transport || '').toLowerCase();
//       return !t.includes('by-hand') && !t.includes('by hand') && !t.includes('byhand');
//     });

//     if (courierLabels.length === 0) {
//       return { total: 0, scanned: 0, missing: 0, partial: 0, percentage: 0 };
//     }

//     const labelIds = courierLabels.map((label: any) => label.id);
//     const { data: scanCounts, error: scanError } = await supabase
//       .from('scan_tally')
//       .select('label_print_id')
//       .in('label_print_id', labelIds);

//     if (scanError) throw scanError;

//     const scanCountMap = (scanCounts || []).reduce((acc: Record<string, number>, scan: any) => {
//       acc[scan.label_print_id] = (acc[scan.label_print_id] || 0) + 1;
//       return acc;
//     }, {});

//     let scanned = 0;
//     let partial = 0;
//     let missing = 0;

//     courierLabels.forEach((label: any) => {
//       const scannedCount = scanCountMap[label.id] || 0;

//       if (scannedCount >= label.boxes) scanned++;
//       else if (scannedCount > 0) partial++;
//       else missing++;
//     });

//     const total = courierLabels.length;
//     const percentage = total > 0 ? (scanned / total) * 100 : 0;

//     return { total, scanned, missing, partial, percentage };
//   } catch (error) {
//     console.error('Error getting scan progress:', error);
//     throw error;
//   }
// }

// /**
//  * Revert all scanned entries back to missing status (preserves label_prints)
//  */
// export async function revertAllScannedEntries(): Promise<number> {
//   try {
//     console.log('[LabelPersistence] Starting revert all scanned entries operation...');

//     const today = new Date();
//     today.setHours(0, 0, 0, 0);

//     const tomorrow = new Date(today);
//     tomorrow.setDate(tomorrow.getDate() + 1);

//     const { count: scanCount, error: scanCountError } = await supabase
//       .from('scan_tally')
//       .select('*', { count: 'exact', head: true })
//       .gte('created_at', today.toISOString())
//       .lt('created_at', tomorrow.toISOString());

//     if (scanCountError) {
//       console.error('[LabelPersistence] Error counting scan entries:', scanCountError);
//       throw scanCountError;
//     }

//     const totalScans = scanCount || 0;

//     if (totalScans === 0) {
//       console.log('[LabelPersistence] No scan entries found to revert');
//       throw new Error('No scanned entries found to revert');
//     }

//     const { error: deleteError } = await supabase
//       .from('scan_tally')
//       .delete()
//       .gte('created_at', today.toISOString())
//       .lt('created_at', tomorrow.toISOString());

//     if (deleteError) {
//       console.error('[LabelPersistence] Error deleting scan_tally entries:', deleteError);
//       throw deleteError;
//     }

//     const { data: todayLabels } = await supabase
//       .from('label_prints')
//       .select('id')
//       .gte('created_at', today.toISOString())
//       .lt('created_at', tomorrow.toISOString());

//     if (todayLabels && todayLabels.length > 0) {
//       const labelIds = todayLabels.map((l: any) => l.id);

//       const { error: boxResetError } = await supabase
//         .from('box_qr_codes')
//         .update({
//           scanned: false,
//           scanned_at: null
//         })
//         .in('label_print_id', labelIds);

//       if (boxResetError) {
//         console.error('[LabelPersistence] Error resetting box QR codes:', boxResetError);
//       }
//     }

//     const { error: updateError } = await supabase
//       .from('label_prints')
//       .update({
//         status: 'missing',
//         scanned_at: null
//       })
//       .gte('created_at', today.toISOString())
//       .lt('created_at', tomorrow.toISOString());

//     if (updateError) {
//       console.error('[LabelPersistence] Error updating label_prints status:', updateError);
//       throw updateError;
//     }

//     console.log(`[LabelPersistence] Successfully reverted ${totalScans} scan entries`);
//     return totalScans;
//   } catch (error) {
//     console.error('[LabelPersistence] Error reverting scanned entries:', error);
//     throw error;
//   }
// }

// /**
//  * Mark a label as printed
//  */
// export async function markLabelAsPrinted(labelPrintId: string): Promise<LabelPrintRecord | null> {
//   try {
//     const { data, error } = await supabase
//       .from('label_prints')
//       .update({
//         is_printed: true,
//         printed_at: new Date().toISOString(),
//         updated_at: new Date().toISOString()
//       })
//       .eq('id', labelPrintId)
//       .select()
//       .single();

//     if (error) throw error;
//     return data as LabelPrintRecord;
//   } catch (error) {
//     console.error('Error marking label as printed:', error);
//     throw error;
//   }
// }

// /**
//  * Mark multiple labels as printed (bulk operation)
//  */
// export async function markLabelsAsPrinted(labelPrintIds: string[]): Promise<LabelPrintRecord[]> {
//   try {
//     if (labelPrintIds.length === 0) return [];

//     const now = new Date().toISOString();
//     const { data, error } = await supabase
//       .from('label_prints')
//       .update({
//         is_printed: true,
//         printed_at: now,
//         updated_at: now
//       })
//       .in('id', labelPrintIds)
//       .select();

//     if (error) throw error;
//     return (data || []) as LabelPrintRecord[];
//   } catch (error) {
//     console.error('Error marking labels as printed:', error);
//     throw error;
//   }
// }

// /**
//  * Regenerate box QR codes for a label print record
//  * This function calls the database function to regenerate all box QR codes
//  * Use this when the box count changes to ensure QR codes match the count
//  */
// export async function regenerateBoxQRCodes(labelPrintId: string, boxCount: number): Promise<BoxQRCode[]> {
//   try {
//     console.log(`[regenerateBoxQRCodes] Regenerating QR codes for label ${labelPrintId}, count: ${boxCount}`);

//     if (boxCount < 1 || boxCount > 150) {
//       throw new Error('Box count must be between 1 and 150');
//     }

//     const { error } = await supabase.rpc('regenerate_box_qr_codes', {
//       p_label_print_id: labelPrintId,
//       p_box_count: boxCount
//     });

//     if (error) throw error;

//     const newBoxQRCodes = await getBoxQRCodes(labelPrintId);
//     console.log(`[regenerateBoxQRCodes] Successfully regenerated ${newBoxQRCodes.length} QR codes`);

//     return newBoxQRCodes;
//   } catch (error) {
//     console.error('[regenerateBoxQRCodes] Error:', error);
//     throw error;
//   }
// }

// /**
//  * Clean up old records (optional maintenance function)
//  */
// export async function cleanupOldRecords(daysToKeep: number = 30): Promise<void> {
//   try {
//     const cutoffDate = new Date();
//     cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

//     const { error } = await supabase
//       .from('label_prints')
//       .delete()
//       .lt('created_at', cutoffDate.toISOString());

//     if (error) throw error;
//   } catch (error) {
//     console.error('Error cleaning up old records:', error);
//     throw error;
//   }
// }

import { supabase, handleSupabaseError } from './supabase';
import { format } from 'date-fns';

export interface BoxQRCode {
  id: string;
  label_print_id: string;
  box_number: number;
  qr_code: string;
  scanned: boolean;
  scanned_at: string | null;
  created_at: string;
}

export interface LabelPrintRecord {
  id: string;
  party_list_id: string;
  qr_code: string;
  party_name: string;
  party_code: string;
  address: string;
  phone_number?: string | null;
  bill_numbers: string[];
  boxes: number;
  transport: string;
  courier_agency_id: string | null;
  label_type: 'courier' | 'byhand';
  status: 'missing' | 'scanned';
  scanned_at: string | null;
  is_printed: boolean;
  printed_at: string | null;
  created_at: string;
  updated_at: string;
  box_qr_codes?: BoxQRCode[];
}

export interface ScanTallyRecord {
  id: string;
  qr_code: string;
  party_name: string;
  party_code: string;
  address: string;
  phone_number?: string | null;
  bill_numbers: string[];
  boxes: number;
  scanned_count: number;
  transport: string;
  courier_agency_id: string | null;
  label_type: 'courier' | 'byhand';
  status: 'missing' | 'scanned';
  scanned_at: string | null;
  created_at: string;
  updated_at: string;
  is_flagged?: boolean;
  scanned_boxes?: number[];
  pending_boxes?: number[];
  box_qr_codes?: string[];
}

export interface PartyListEntry {
  id: string;
  date: string;
  party_code: string;
  bill_numbers: string[];
  boxes: number;
  courier_agency_id: string;
  serialNumber: number;
  party_info: {
    party_name: string;
    address: string;
    phone_number?: string;
  };
  courier_agency: {
    agency_name: string;
  };
}


/**
 * Determine label type based on courier agency name
 */
export function determineLabelType(courierName: string): 'courier' | 'byhand' {
  const normalizedName = (courierName || '').toLowerCase();
  const isByHand = normalizedName.includes('by-hand') ||
                   normalizedName.includes('by hand') ||
                   normalizedName.includes('byhand');
  return isByHand ? 'byhand' : 'courier';
}

// ============================================================
// FIX: generateBoxQRCodes now generates a FULLY UNIQUE QR code
// for EACH box independently. No more shared baseId + suffix.
// Box 1 and Box 2 for the same party get completely different codes.
// ============================================================

/**
 * Generate a single unique QR code string.
 * Format: DS + YYMMDD + 6 random alphanumeric characters
 * e.g. DS260305M29EDR
 */
function generateUniqueQRCode(): string {
  const datePrefix = format(new Date(), 'yyMMdd');
  const uniqueId = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `DS${datePrefix}${uniqueId}`;
}

/**
 * Generate unique QR codes for each box in a shipment.
 * Each box gets its own completely independent QR code — no suffix, no shared root.
 */
async function generateBoxQRCodes(
  labelPrintId: string,
  boxCount: number
): Promise<BoxQRCode[]> {
  try {
    console.log(`[generateBoxQRCodes] Starting for label ${labelPrintId}, count: ${boxCount}`);

    const boxQRData = [];
    for (let boxNum = 1; boxNum <= boxCount; boxNum++) {
      // FIX: Each box gets its own fresh unique QR code — not a shared base + suffix
      const qrCode = generateUniqueQRCode();
      boxQRData.push({
        label_print_id: labelPrintId,
        box_number: boxNum,
        qr_code: qrCode,
        scanned: false
      });
    }

    console.log(`[generateBoxQRCodes] Prepared ${boxQRData.length} QR codes (each fully unique)`);

    const { data, error } = await supabase
      .from('box_qr_codes')
      .insert(boxQRData)
      .select();

    if (error) {
      console.error('[generateBoxQRCodes] Database error:', error);
      throw new Error(`Database insert failed: ${error.message} (${error.code})`);
    }

    console.log(`[generateBoxQRCodes] Success! Generated ${data?.length || 0} QR codes`);
    return (data || []) as BoxQRCode[];
  } catch (error) {
    console.error('[generateBoxQRCodes] Error:', error);
    if (error instanceof Error) {
      throw new Error(`QR code generation failed: ${error.message}`);
    }
    throw new Error('QR code generation failed: Unknown error');
  }
}

/**
 * Get box QR codes for a label print record
 */
export async function getBoxQRCodes(labelPrintId: string): Promise<BoxQRCode[]> {
  try {
    const { data, error } = await supabase
      .from('box_qr_codes')
      .select('*')
      .eq('label_print_id', labelPrintId)
      .order('box_number', { ascending: true });

    if (error) throw error;
    return (data || []) as BoxQRCode[];
  } catch (error) {
    console.error('Error fetching box QR codes:', error);
    throw error;
  }
}

/**
 * Get or generate box QR codes for a label print record.
 * Ensures box QR codes exist, generating them if missing.
 */
export async function getOrGenerateBoxQRCodes(labelPrintId: string, boxCount: number): Promise<BoxQRCode[]> {
  try {
    console.log(`[getOrGenerateBoxQRCodes] Starting for label ${labelPrintId}, boxCount: ${boxCount}`);

    let boxQRCodes = await getBoxQRCodes(labelPrintId);
    console.log(`[getOrGenerateBoxQRCodes] Found ${boxQRCodes.length} existing QR codes`);

    if (boxQRCodes.length === 0 || boxQRCodes.length !== boxCount) {
      console.log(`[getOrGenerateBoxQRCodes] Generating missing box QR codes (found ${boxQRCodes.length}, need ${boxCount})`);

      if (boxQRCodes.length > 0) {
        console.log(`[getOrGenerateBoxQRCodes] Deleting incomplete QR codes`);
        const { error: deleteError } = await supabase
          .from('box_qr_codes')
          .delete()
          .eq('label_print_id', labelPrintId);

        if (deleteError) {
          console.error('[getOrGenerateBoxQRCodes] Error deleting incomplete box QR codes:', deleteError);
          throw new Error(`Failed to delete incomplete QR codes: ${deleteError.message}`);
        }
      }

      console.log(`[getOrGenerateBoxQRCodes] Calling generateBoxQRCodes`);
      boxQRCodes = await generateBoxQRCodes(labelPrintId, boxCount);
      console.log(`[getOrGenerateBoxQRCodes] Generated ${boxQRCodes.length} QR codes`);
    }

    return boxQRCodes;
  } catch (error) {
    console.error('[getOrGenerateBoxQRCodes] Error:', error);
    if (error instanceof Error) {
      throw new Error(`QR code generation failed: ${error.message}`);
    }
    throw new Error('QR code generation failed: Unknown error');
  }
}

/**
 * Create a single label print record with its own safe QR code.
 */
export async function createLabelPrintRecord(
  partyEntry: PartyListEntry
): Promise<LabelPrintRecord | null> {
  try {
    const labelType = determineLabelType(partyEntry.courier_agency?.agency_name || '');

    // Check if label already exists for this party_list_id
    const { data: existingLabel, error: checkError } = await supabase
      .from('label_prints')
      .select('id')
      .eq('party_list_id', partyEntry.id)
      .maybeSingle();

    if (checkError) throw checkError;

    if (existingLabel) {
      console.log(`Label already exists for party ${partyEntry.party_code}`);
      return null;
    }

    // Generate a safe, random QR code for the parent label record
    const qrCode = generateUniqueQRCode();

    const labelPrintData = {
      party_list_id: partyEntry.id,
      qr_code: qrCode,
      party_name: partyEntry.party_info?.party_name || 'Unknown Party',
      party_code: partyEntry.party_code,
      address: partyEntry.party_info?.address || 'Unknown Address',
      phone_number: partyEntry.party_info?.phone_number || null,
      bill_numbers: partyEntry.bill_numbers || [],
      boxes: partyEntry.boxes,
      transport: partyEntry.courier_agency?.agency_name || 'Unknown Transport',
      courier_agency_id: partyEntry.courier_agency_id,
      label_type: labelType,
      status: 'missing'
    };

    const { data: labelPrint, error: labelError } = await supabase
      .from('label_prints')
      .insert([labelPrintData])
      .select()
      .single();

    if (labelError) throw labelError;

    // Each box gets its own unique QR code via generateBoxQRCodes
    await generateBoxQRCodes(labelPrint.id, partyEntry.boxes);

    return labelPrint as LabelPrintRecord;
  } catch (error) {
    console.error('Error creating label print record:', error);
    throw error;
  }
}

/**
 * Update an existing label print record with merged bill numbers and boxes.
 * Called when bills are merged into an existing party entry.
 */
export async function updateLabelPrintRecord(
  partyEntry: PartyListEntry
): Promise<LabelPrintRecord | null> {
  try {
    const labelType = determineLabelType(partyEntry.courier_agency?.agency_name || '');

    // Find existing label for this party_list_id
    const { data: existingLabel, error: checkError } = await supabase
      .from('label_prints')
      .select('*')
      .eq('party_list_id', partyEntry.id)
      .maybeSingle();

    if (checkError) throw checkError;

    if (!existingLabel) {
      // Label doesn't exist, create it instead
      console.log(`Label not found for party ${partyEntry.party_code}, creating new one`);
      return await createLabelPrintRecord(partyEntry);
    }

    // Update existing label with merged data
    const { data: updatedLabel, error: updateError } = await supabase
      .from('label_prints')
      .update({
        bill_numbers: partyEntry.bill_numbers || [],
        boxes: partyEntry.boxes,
        transport: partyEntry.courier_agency?.agency_name || 'Unknown Transport',
        courier_agency_id: partyEntry.courier_agency_id,
        label_type: labelType,
        updated_at: new Date().toISOString()
      })
      .eq('id', existingLabel.id)
      .select()
      .single();

    if (updateError) throw updateError;

    if (existingLabel.boxes !== partyEntry.boxes) {
      const { error: deleteError } = await supabase
        .from('box_qr_codes')
        .delete()
        .eq('label_print_id', existingLabel.id);

      if (deleteError) {
        console.error('Error deleting old box QR codes:', deleteError);
      } else {
        // Each new box gets its own unique QR code
        await generateBoxQRCodes(existingLabel.id, partyEntry.boxes);
      }
    }

    console.log(`Updated label for party ${partyEntry.party_code} with ${partyEntry.bill_numbers.length} bills and ${partyEntry.boxes} boxes`);
    return updatedLabel as LabelPrintRecord;
  } catch (error) {
    console.error('Error updating label print record:', error);
    throw error;
  }
}

/**
 * Batch create label print records for multiple party entries.
 */
export async function batchCreateLabelPrintRecords(
  partyEntries: PartyListEntry[]
): Promise<{ labelPrints: LabelPrintRecord[] }> {
  try {
    if (partyEntries.length === 0) return { labelPrints: [] };

    const labelPrintData = partyEntries.map((entry) => {
      // Each parent label gets its own unique QR code
      const qrCode = generateUniqueQRCode();
      const labelType = determineLabelType(entry.courier_agency?.agency_name || '');

      return {
        party_list_id: entry.id,
        qr_code: qrCode,
        party_name: entry.party_info?.party_name || 'Unknown Party',
        party_code: entry.party_code,
        address: entry.party_info?.address || 'Unknown Address',
        phone_number: entry.party_info?.phone_number || null,
        bill_numbers: entry.bill_numbers || [],
        boxes: entry.boxes,
        transport: entry.courier_agency?.agency_name || 'Unknown Transport',
        courier_agency_id: entry.courier_agency_id,
        label_type: labelType,
        status: 'missing'
      };
    });

    const { data: labelPrints, error: labelError } = await supabase
      .from('label_prints')
      .insert(labelPrintData)
      .select();

    if (labelError) throw labelError;

    const createdLabels = (labelPrints || []) as LabelPrintRecord[];

    for (const label of createdLabels) {
      // Each box inside each label gets its own unique QR code
      await generateBoxQRCodes(label.id, label.boxes);
    }

    return { labelPrints: createdLabels };
  } catch (error) {
    console.error('Error batch creating label print records:', error);
    throw error;
  }
}

/**
 * (Legacy) Get today's label print records by created_at day-window.
 * Kept for compatibility; prefer getLabelPrintsByPartyIds for exact matching.
 */
export async function getTodaysLabelPrints(): Promise<LabelPrintRecord[]> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const { data, error } = await supabase
      .from('label_prints')
      .select('*')
      .gte('created_at', today.toISOString())
      .lt('created_at', tomorrow.toISOString())
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data || []) as LabelPrintRecord[];
  } catch (error) {
    console.error("Error fetching today's label prints:", error);
    throw error;
  }
}

/**
 * Exact: fetch label_prints for a given set of party_list ids.
 * Use this to align with today's party_list irrespective of when labels were created.
 */
export async function getLabelPrintsByPartyIds(
  partyListIds: string[]
): Promise<LabelPrintRecord[]> {
  try {
    if (partyListIds.length === 0) return [];

    const { data, error } = await supabase
      .from('label_prints')
      .select('*')
      .in('party_list_id', partyListIds)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data || []) as LabelPrintRecord[];
  } catch (error) {
    console.error('Error fetching label prints by party ids:', error);
    throw error;
  }
}

/**
 * Get today's scan tally records from label_prints table (couriers-only)
 */
export async function getTodaysScanTally(): Promise<ScanTallyRecord[]> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const { data: labelPrints, error } = await supabase
      .from('label_prints')
      .select('*')
      .gte('created_at', today.toISOString())
      .lt('created_at', tomorrow.toISOString())
      .order('created_at', { ascending: true });

    if (error) throw error;

    const courierLabels = (labelPrints || []).filter((record: any) => {
      const t = (record.transport || '').toLowerCase();
      return !t.includes('by-hand') && !t.includes('by hand') && !t.includes('byhand');
    });

    if (courierLabels.length === 0) {
      return [];
    }

    const labelIds = courierLabels.map((record: any) => record.id);

    const { data: boxQRCodes, error: boxError } = await supabase
      .from('box_qr_codes')
      .select('label_print_id, box_number, qr_code, scanned')
      .in('label_print_id', labelIds)
      .order('box_number', { ascending: true });

    if (boxError) throw boxError;

    const boxScanMap = (boxQRCodes || []).reduce((acc: Record<string, { scanned: number[], pending: number[], qr_codes: string[] }>, box: any) => {
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
    }, {});

    return courierLabels.map((record: any) => {
      const boxInfo = boxScanMap[record.id] || { scanned: [], pending: [], qr_codes: [] };
      const scannedCount = boxInfo.scanned.length;
      const isFullyScanned = scannedCount >= record.boxes;

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
        status: isFullyScanned ? 'scanned' : 'missing',
        scanned_at: record.scanned_at,
        created_at: record.created_at,
        updated_at: record.updated_at,
        scanned_boxes: boxInfo.scanned,
        pending_boxes: boxInfo.pending,
        box_qr_codes: boxInfo.qr_codes
      } as ScanTallyRecord;
    });
  } catch (error) {
    console.error("Error fetching today's scan tally:", error);
    throw error;
  }
}

/**
 * Mark barcode as scanned by inserting into scan_tally event log.
 * Supports both box-specific QR codes and parent label QR codes.
 * Optimized for speed with parallel queries.
 */
export async function markBarcodeAsScanned(qrCode: string): Promise<{
  party_name: string;
  scanned_count: number;
  boxes: number;
  id: string;
  box_number?: number;
} | null> {
  try {
    const timestamp = new Date().toISOString();

    // PARALLEL: Check both box QR and parent label QR simultaneously
    const [boxResult, labelResult] = await Promise.all([
      supabase
        .from('box_qr_codes')
        .select('id, label_print_id, box_number, scanned')
        .eq('qr_code', qrCode)
        .maybeSingle(),
      supabase
        .from('label_prints')
        .select('id, party_name, party_code, boxes')
        .eq('qr_code', qrCode)
        .maybeSingle()
    ]);

    if (boxResult.error) throw boxResult.error;
    if (labelResult.error) throw labelResult.error;

    let labelPrintId: string;
    let boxToScan: { id: string; box_number: number } | null = null;
    let labelPrint: any;

    if (boxResult.data) {
      // Found as box-specific QR code
      if (boxResult.data.scanned) {
        // Fetch label for error message only if needed
        const { data: labelInfo } = await supabase
          .from('label_prints')
          .select('party_name')
          .eq('id', boxResult.data.label_print_id)
          .single();
        throw new Error(`Box ${boxResult.data.box_number} already scanned for ${labelInfo?.party_name || 'this party'}`);
      }

      labelPrintId = boxResult.data.label_print_id;
      boxToScan = { id: boxResult.data.id, box_number: boxResult.data.box_number };

      // Get label print info
      const { data: labelInfo, error: labelError } = await supabase
        .from('label_prints')
        .select('id, party_name, party_code, boxes')
        .eq('id', labelPrintId)
        .single();

      if (labelError) throw labelError;
      labelPrint = labelInfo;

    } else if (labelResult.data) {
      // Found as parent label QR code — find first unscanned box
      labelPrint = labelResult.data;
      labelPrintId = labelPrint.id;

      const { data: unscannedBox, error: unscannedError } = await supabase
        .from('box_qr_codes')
        .select('id, box_number')
        .eq('label_print_id', labelPrintId)
        .eq('scanned', false)
        .order('box_number', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (unscannedError) throw unscannedError;
      if (!unscannedBox) {
        throw new Error(`All boxes already scanned for ${labelPrint.party_name}`);
      }

      boxToScan = { id: unscannedBox.id, box_number: unscannedBox.box_number };
    } else {
      throw new Error(`Barcode ${qrCode} not found in today's entries`);
    }

    // PARALLEL: Get scanned count, update box, and insert scan event simultaneously
    const [scannedBoxesResult, updateBoxResult, insertScanResult] = await Promise.all([
      supabase
        .from('box_qr_codes')
        .select('id', { count: 'exact' })
        .eq('label_print_id', labelPrintId)
        .eq('scanned', true),
      supabase
        .from('box_qr_codes')
        .update({
          scanned: true,
          scanned_at: timestamp
        })
        .eq('id', boxToScan.id),
      supabase
        .from('scan_tally')
        .insert([{
          label_print_id: labelPrint.id,
          qr_code: qrCode,
          status: 'scanned',
          scanned_at: timestamp
        }])
    ]);

    if (scannedBoxesResult.error) throw scannedBoxesResult.error;
    if (updateBoxResult.error) throw updateBoxResult.error;
    if (insertScanResult.error) throw insertScanResult.error;

    const currentScannedCount = scannedBoxesResult.data?.length || 0;
    const newScannedCount = currentScannedCount + 1;

    // Background: Update label_prints status if fully scanned (non-blocking)
    if (newScannedCount >= labelPrint.boxes) {
      supabase
        .from('label_prints')
        .update({
          status: 'scanned',
          scanned_at: timestamp
        })
        .eq('id', labelPrint.id)
        .then(({ error }) => {
          if (error) console.error('Error updating label_prints status:', error);
        });
    }

    return {
      party_name: labelPrint.party_name,
      scanned_count: newScannedCount,
      boxes: labelPrint.boxes,
      id: labelPrint.id,
      box_number: boxToScan.box_number
    };
  } catch (error) {
    console.error('Error marking barcode as scanned:', error);
    throw error;
  }
}

/**
 * Get scan progress statistics (couriers-only)
 */
export async function getScanProgress(fromDate?: string, toDate?: string): Promise<{
  total: number;
  scanned: number;
  missing: number;
  partial: number;
  percentage: number;
}> {
  try {
    let startDate: Date;
    let endDate: Date;

    if (fromDate && toDate) {
      startDate = new Date(fromDate);
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(toDate);
      endDate.setHours(23, 59, 59, 999);
    } else {
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 1);
    }

    const { data: labelPrints, error } = await supabase
      .from('label_prints')
      .select('id, boxes, transport')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    if (error) throw error;

    const courierLabels = (labelPrints || []).filter((record: any) => {
      const t = (record.transport || '').toLowerCase();
      return !t.includes('by-hand') && !t.includes('by hand') && !t.includes('byhand');
    });

    if (courierLabels.length === 0) {
      return { total: 0, scanned: 0, missing: 0, partial: 0, percentage: 0 };
    }

    const labelIds = courierLabels.map((label: any) => label.id);
    const { data: scanCounts, error: scanError } = await supabase
      .from('scan_tally')
      .select('label_print_id')
      .in('label_print_id', labelIds);

    if (scanError) throw scanError;

    const scanCountMap = (scanCounts || []).reduce((acc: Record<string, number>, scan: any) => {
      acc[scan.label_print_id] = (acc[scan.label_print_id] || 0) + 1;
      return acc;
    }, {});

    let scanned = 0;
    let partial = 0;
    let missing = 0;

    courierLabels.forEach((label: any) => {
      const scannedCount = scanCountMap[label.id] || 0;

      if (scannedCount >= label.boxes) scanned++;
      else if (scannedCount > 0) partial++;
      else missing++;
    });

    const total = courierLabels.length;
    const percentage = total > 0 ? (scanned / total) * 100 : 0;

    return { total, scanned, missing, partial, percentage };
  } catch (error) {
    console.error('Error getting scan progress:', error);
    throw error;
  }
}

/**
 * Revert all scanned entries back to missing status (preserves label_prints)
 */
export async function revertAllScannedEntries(): Promise<number> {
  try {
    console.log('[LabelPersistence] Starting revert all scanned entries operation...');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const { count: scanCount, error: scanCountError } = await supabase
      .from('scan_tally')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today.toISOString())
      .lt('created_at', tomorrow.toISOString());

    if (scanCountError) {
      console.error('[LabelPersistence] Error counting scan entries:', scanCountError);
      throw scanCountError;
    }

    const totalScans = scanCount || 0;

    if (totalScans === 0) {
      console.log('[LabelPersistence] No scan entries found to revert');
      throw new Error('No scanned entries found to revert');
    }

    const { error: deleteError } = await supabase
      .from('scan_tally')
      .delete()
      .gte('created_at', today.toISOString())
      .lt('created_at', tomorrow.toISOString());

    if (deleteError) {
      console.error('[LabelPersistence] Error deleting scan_tally entries:', deleteError);
      throw deleteError;
    }

    const { data: todayLabels } = await supabase
      .from('label_prints')
      .select('id')
      .gte('created_at', today.toISOString())
      .lt('created_at', tomorrow.toISOString());

    if (todayLabels && todayLabels.length > 0) {
      const labelIds = todayLabels.map((l: any) => l.id);

      const { error: boxResetError } = await supabase
        .from('box_qr_codes')
        .update({
          scanned: false,
          scanned_at: null
        })
        .in('label_print_id', labelIds);

      if (boxResetError) {
        console.error('[LabelPersistence] Error resetting box QR codes:', boxResetError);
      }
    }

    const { error: updateError } = await supabase
      .from('label_prints')
      .update({
        status: 'missing',
        scanned_at: null
      })
      .gte('created_at', today.toISOString())
      .lt('created_at', tomorrow.toISOString());

    if (updateError) {
      console.error('[LabelPersistence] Error updating label_prints status:', updateError);
      throw updateError;
    }

    console.log(`[LabelPersistence] Successfully reverted ${totalScans} scan entries`);
    return totalScans;
  } catch (error) {
    console.error('[LabelPersistence] Error reverting scanned entries:', error);
    throw error;
  }
}

/**
 * Mark a label as printed
 */
export async function markLabelAsPrinted(labelPrintId: string): Promise<LabelPrintRecord | null> {
  try {
    const { data, error } = await supabase
      .from('label_prints')
      .update({
        is_printed: true,
        printed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', labelPrintId)
      .select()
      .single();

    if (error) throw error;
    return data as LabelPrintRecord;
  } catch (error) {
    console.error('Error marking label as printed:', error);
    throw error;
  }
}

/**
 * Mark multiple labels as printed (bulk operation)
 */
export async function markLabelsAsPrinted(labelPrintIds: string[]): Promise<LabelPrintRecord[]> {
  try {
    if (labelPrintIds.length === 0) return [];

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('label_prints')
      .update({
        is_printed: true,
        printed_at: now,
        updated_at: now
      })
      .in('id', labelPrintIds)
      .select();

    if (error) throw error;
    return (data || []) as LabelPrintRecord[];
  } catch (error) {
    console.error('Error marking labels as printed:', error);
    throw error;
  }
}

/**
 * Regenerate box QR codes for a label print record when box count changes.
 * Calls the database RPC function which also generates fully unique QR codes per box.
 */
export async function regenerateBoxQRCodes(labelPrintId: string, boxCount: number): Promise<BoxQRCode[]> {
  try {
    console.log(`[regenerateBoxQRCodes] Regenerating QR codes for label ${labelPrintId}, count: ${boxCount}`);

    if (boxCount < 1 || boxCount > 150) {
      throw new Error('Box count must be between 1 and 150');
    }

    // Delete existing box QR codes first
    const { error: deleteError } = await supabase
      .from('box_qr_codes')
      .delete()
      .eq('label_print_id', labelPrintId);

    if (deleteError) {
      console.error('[regenerateBoxQRCodes] Error deleting old QR codes:', deleteError);
      throw deleteError;
    }

    // Generate fresh unique QR codes for each box using the same
    // generateBoxQRCodes function — each box gets a completely independent code
    const newBoxQRCodes = await generateBoxQRCodes(labelPrintId, boxCount);
    console.log(`[regenerateBoxQRCodes] Successfully regenerated ${newBoxQRCodes.length} QR codes`);

    return newBoxQRCodes;
  } catch (error) {
    console.error('[regenerateBoxQRCodes] Error:', error);
    throw error;
  }
}

/**
 * Clean up old records (optional maintenance function)
 */
export async function cleanupOldRecords(daysToKeep: number = 30): Promise<void> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const { error } = await supabase
      .from('label_prints')
      .delete()
      .lt('created_at', cutoffDate.toISOString());

    if (error) throw error;
  } catch (error) {
    console.error('Error cleaning up old records:', error);
    throw error;
  }
}
