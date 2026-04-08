import React from 'react';
import { X } from 'lucide-react';

interface EditDialogProps {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  maxWidthClass?: string;
}

export function EditDialog({
  open,
  title,
  children,
  onClose,
  footer,
  maxWidthClass = 'max-w-lg'
}: EditDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className={`w-full ${maxWidthClass} max-h-[90vh] overflow-hidden rounded-lg bg-white shadow-xl`}>
        <div className="flex items-center justify-between border-b p-5">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto p-5">
          {children}
        </div>
        {footer && (
          <div className="flex justify-end gap-3 border-t bg-gray-50 p-5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
