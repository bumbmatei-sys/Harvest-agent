"use client";
import React from 'react';
import { MoreVertical } from 'lucide-react';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu';

export interface KebabMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface KebabMenuProps {
  items: KebabMenuItem[];
  size?: number;
  ariaLabel?: string;
}

const KebabMenu: React.FC<KebabMenuProps> = ({ items, size = 16, ariaLabel = 'More options' }) => {
  if (items.length === 0) return null;
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" aria-label={ariaLabel} className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0" onClick={e => e.stopPropagation()} />}>
      <MoreVertical size={size} />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" aria-label={ariaLabel} onClick={e => e.stopPropagation()}>
      {items.map((item, i) => <DropdownMenuItem key={i} variant={item.danger ? 'destructive' : 'default'} disabled={item.disabled} onClick={item.onClick}>{item.label}</DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
};
export default KebabMenu;
