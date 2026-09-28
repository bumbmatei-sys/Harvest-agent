"use client";
import React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import type { PublishedGivingLink } from './giving-providers';

/**
 * A checkbox group, because the choice is a subset and each option is
 * independent. `toggle-group` was rejected: its multiple mode looks like a
 * segmented control, which reads as "pick one" on a row of six. `select` was
 * rejected because a multi-select is the worst control on a phone.
 * `radio-group` was rejected because it cannot express "all of them".
 *
 * Ticking adds the provider id; unticking removes it. The caller stores ids
 * only. The wrapper attribute is the caller's (`data-event-provider-picker`
 * or `data-campaign-provider-picker`) so each screen keeps the hook its
 * tests already query.
 */
const PaymentLinkPicker: React.FC<{
  links: readonly PublishedGivingLink[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  title: string;
  help: string;
  wrapperAttribute: string;
}> = ({ links, selected, onChange, title, help, wrapperAttribute }) => (
  <div {...{ [wrapperAttribute]: true }}>
    <p className="text-xs font-semibold text-body mb-1">{title}</p>
    <p className="text-xs text-muted mb-2.5">{help}</p>
    <div className="space-y-1">
      {links.map(({ provider }) => {
        const ticked = selected.includes(provider.id);
        return (
          <label
            key={provider.id}
            data-provider-option={provider.id}
            className="flex items-center gap-2.5 min-h-11 sm:min-h-0 cursor-pointer"
          >
            <Checkbox
              checked={ticked}
              onCheckedChange={() => onChange(
                ticked
                  ? selected.filter((id) => id !== provider.id)
                  : [...selected, provider.id],
              )}
            />
            <span className="text-sm text-body">{provider.label}</span>
          </label>
        );
      })}
    </div>
  </div>
);

export default PaymentLinkPicker;
