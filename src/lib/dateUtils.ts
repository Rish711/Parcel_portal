import { format } from 'date-fns';

// Format time in 12-hour format
export function formatTime(date: Date): string {
  return format(date, 'hh:mm a');
}

// Format date
export function formatDate(date: Date): string {
  return format(date, 'dd/MM/yyyy');
}

// Format date and time
export function formatDateTime(date: Date): string {
  return format(date, 'dd/MM/yyyy hh:mm a');
}

// Get current date time
export function getCurrentDateTime(): string {
  return new Date().toISOString();
}