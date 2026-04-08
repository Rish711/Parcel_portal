import { useState, useCallback } from 'react';

interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'primary';
}

interface ConfirmDialogState extends ConfirmDialogOptions {
  open: boolean;
  resolve?: (value: boolean) => void;
}

export function useConfirmDialog() {
  const [dialogState, setDialogState] = useState<ConfirmDialogState>({
    open: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    variant: 'primary'
  });

  const openConfirmDialog = useCallback((options: ConfirmDialogOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialogState({
        ...options,
        open: true,
        resolve
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setDialogState(prev => {
      prev.resolve?.(true);
      return { ...prev, open: false, resolve: undefined };
    });
  }, []);

  const handleCancel = useCallback(() => {
    setDialogState(prev => {
      prev.resolve?.(false);
      return { ...prev, open: false, resolve: undefined };
    });
  }, []);

  return {
    dialogState,
    openConfirmDialog,
    handleConfirm,
    handleCancel
  };
}