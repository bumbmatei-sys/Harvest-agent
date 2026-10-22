"use client";

import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { ACTION_BUTTON, CONTROL_DENSITY } from '../layout/form-layout';

const TOUCH_FLOOR = 'min-h-11 sm:min-h-0';

/**
 * Cancel Subscription — the Danger zone body. Handlers and copy match the
 * AdminSettings accordion row; the confirm dialog is the same primitive at the
 * same z-[200] layer THE-295 pins.
 */
export default function CancelPlanBlock({
  onConfirm,
}: {
  onConfirm: () => void;
}) {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  return (
    <div data-settings-section="danger">
      <p className="text-muted text-sm">Cancel your subscription. Your ministry will remain active until the end of the current billing period.</p>
      <Separator className="my-4" />
      <Button
        variant="destructive"
        onClick={() => setShowCancelConfirm(true)}
        className={`text-sm font-medium ${TOUCH_FLOOR} ${ACTION_BUTTON} ${CONTROL_DENSITY.action}`}
      >
        Cancel Subscription
      </Button>

      <Dialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <DialogPortal>
          <DialogOverlay className="z-[200] bg-black/50" />
          <DialogContent className="z-[200] max-w-md" showCloseButton={false}>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                  <AlertTriangle size={20} className="text-destructive" />
                </span>
                <DialogTitle className="text-lg font-bold text-strong font-display">Cancel Subscription?</DialogTitle>
              </div>
            </DialogHeader>
            <DialogDescription className="text-muted text-sm">
              Your ministry will remain active until the end of the current billing period. After that, all data will be preserved but your ministry will be suspended.
            </DialogDescription>
            <DialogFooter>
              <DialogClose
                render={
                  <Button variant="ghost" className={`text-sm font-medium ${TOUCH_FLOOR} ${CONTROL_DENSITY.action}`} />
                }
              >
                Keep Plan
              </DialogClose>
              <Button
                variant="destructive"
                onClick={() => { onConfirm(); setShowCancelConfirm(false); }}
                className={`text-sm font-semibold ${TOUCH_FLOOR} ${CONTROL_DENSITY.action}`}
              >
                Yes, Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </DialogPortal>
      </Dialog>
    </div>
  );
}
