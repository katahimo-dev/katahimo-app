import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { showToast } from '../../../ui/toast';
import { adminQueryKeys } from '../adminQueryKeys';
import type { AdminSettingsForm } from './useAdminSettingsForm';

/** 「保存する」(保存できたらお知らせを出し、操作ログを読み直す)。 */
export function useSaveSettings(form: AdminSettingsForm, doneMessage: string) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const ok = await form.save();
    setSaving(false);
    if (ok) {
      showToast(doneMessage);
      void queryClient.invalidateQueries({ queryKey: adminQueryKeys.auditLogsAll });
    }
  };
  return { saving, save };
}
