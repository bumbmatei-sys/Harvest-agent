"use client";
import React, { useState, useRef, useEffect } from 'react';
import { X, GripVertical, Save } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';

export interface NavTab {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>;
}

interface AdminNavCustomizerProps {
  /** Full list of permission-filtered tabs to arrange. */
  allTabs: NavTab[];
  /** IDs currently assigned to the bottom bar (in order). */
  currentPrimaryIds: string[];
  /** Called with the new ordered primary IDs after a successful save. */
  onSave: (primaryIds: string[]) => void;
  /** Called when the user cancels without saving. */
  onCancel: () => void;
}

// ─── Sortable item row ────────────────────────────────────────────────────────

interface SortableNavItemProps {
  item: NavTab;
  /** Dims the item while it is being actively dragged (drag-ghost). */
  isBeingDragged: boolean;
}

const SortableNavItem: React.FC<SortableNavItemProps> = ({ item, isBeingDragged }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id });
  const Icon = item.icon;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isBeingDragged ? 0.35 : 1,
      }}
      className="flex items-center gap-3 bg-white rounded-[14px] p-3 border border-gray-100 shadow-sm select-none"
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-400 touch-none"
        aria-label="Drag to reorder"
      >
        <GripVertical size={20} />
      </div>

      <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-[#F7F6F3] flex-shrink-0">
        <Icon size={18} style={{ color: 'var(--brand-color, #d4a017)' }} />
      </div>

      <span className="text-sm font-semibold text-gray-800 truncate">{item.label}</span>
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

const MAX_BAR_ITEMS = 4;

const AdminNavCustomizer: React.FC<AdminNavCustomizerProps> = ({
  allTabs,
  currentPrimaryIds,
  onSave,
  onCancel,
}) => {
  // Split allTabs into bar and drawer based on currentPrimaryIds order.
  const initialBar = (): NavTab[] => {
    const ordered = currentPrimaryIds
      .map((id) => allTabs.find((t) => t.id === id))
      .filter(Boolean) as NavTab[];
    return ordered.slice(0, MAX_BAR_ITEMS);
  };
  const initialDrawer = (): NavTab[] => {
    const barSet = new Set(currentPrimaryIds.slice(0, MAX_BAR_ITEMS));
    return allTabs.filter((t) => !barSet.has(t.id));
  };

  const [barItems, setBarItems] = useState<NavTab[]>(initialBar);
  const [drawerItems, setDrawerItems] = useState<NavTab[]>(initialDrawer);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Refs always point to the latest state for use inside event handlers (avoids
  // stale-closure bugs when onDragOver and onDragEnd fire in rapid succession).
  const barRef = useRef(barItems);
  const drawerRef = useRef(drawerItems);
  useEffect(() => { barRef.current = barItems; }, [barItems]);
  useEffect(() => { drawerRef.current = drawerItems; }, [drawerItems]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } })
  );

  /** Returns which section the given item ID currently belongs to. */
  const findSection = (id: string): 'bar' | 'drawer' | null => {
    if (barRef.current.find((i) => i.id === id)) return 'bar';
    if (drawerRef.current.find((i) => i.id === id)) return 'drawer';
    return null;
  };

  const activeItem =
    activeId
      ? (barRef.current.find((i) => i.id === activeId) ?? drawerRef.current.find((i) => i.id === activeId))
      : null;

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveId(active.id as string);
  };

  /**
   * Fired continuously while dragging. Handles moving items between sections.
   * Same-section reordering is handled lazily in onDragEnd via arrayMove.
   */
  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;

    const activeSection = findSection(active.id as string);
    // The "over" target may be an item ID (so we look up its section) or a container ID.
    const overId = over.id as string;
    const overSection = findSection(overId) ?? (overId === 'bar-droppable' ? 'bar' : overId === 'drawer-droppable' ? 'drawer' : null);

    if (!activeSection || !overSection || activeSection === overSection) return;

    if (overSection === 'bar') {
      const draggedItem = drawerRef.current.find((i) => i.id === active.id);
      if (!draggedItem) return;

      if (barRef.current.length >= MAX_BAR_ITEMS) {
        // Bar is full — displace the last item to the drawer.
        const displaced = barRef.current[barRef.current.length - 1];
        setBarItems((prev) => [...prev.slice(0, -1), draggedItem]);
        setDrawerItems((prev) => [displaced, ...prev.filter((i) => i.id !== active.id)]);
      } else {
        setBarItems((prev) => [...prev, draggedItem]);
        setDrawerItems((prev) => prev.filter((i) => i.id !== active.id));
      }
    } else if (overSection === 'drawer') {
      const draggedItem = barRef.current.find((i) => i.id === active.id);
      if (!draggedItem) return;
      setDrawerItems((prev) => [draggedItem, ...prev]);
      setBarItems((prev) => prev.filter((i) => i.id !== active.id));
    }
  };

  /**
   * Fired once when the drag is released. Handles reordering within the same section.
   */
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over || active.id === over.id) return;

    const activeSection = findSection(active.id as string);
    const overSection = findSection(over.id as string);

    if (activeSection === overSection && activeSection !== null) {
      if (activeSection === 'bar') {
        const oldIdx = barRef.current.findIndex((i) => i.id === active.id);
        const newIdx = barRef.current.findIndex((i) => i.id === over.id);
        if (oldIdx !== -1 && newIdx !== -1) {
          setBarItems(arrayMove(barRef.current, oldIdx, newIdx));
        }
      } else {
        const oldIdx = drawerRef.current.findIndex((i) => i.id === active.id);
        const newIdx = drawerRef.current.findIndex((i) => i.id === over.id);
        if (oldIdx !== -1 && newIdx !== -1) {
          setDrawerItems(arrayMove(drawerRef.current, oldIdx, newIdx));
        }
      }
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const primaryIds = barRef.current.map((i) => i.id);
      if (auth.currentUser) {
        await updateDoc(doc(db, 'users', auth.currentUser.uid), {
          adminNavConfig: { primaryTabIds: primaryIds },
        });
      }
      onSave(primaryIds);
    } catch (e) {
      console.error('Failed to save nav config:', e);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] bg-[#F7F6F3] flex flex-col">
      {/* ─── Header ─────────────────────────────────────────────────── */}
      <div className="bg-white px-4 py-3 flex items-center justify-between shadow-sm border-b border-gray-100 flex-shrink-0">
        <button
          onClick={onCancel}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
          aria-label="Cancel"
        >
          <X size={20} className="text-gray-600" />
        </button>

        <h2 className="text-base font-bold text-gray-900">Customize Navigation</h2>

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
          style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
        >
          {saving ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Save size={14} />
          )}
          Save
        </button>
      </div>

      {/* ─── Draggable content ──────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {/* Bottom Bar section */}
          <section className="mb-6">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Bottom Bar</h3>
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  barItems.length >= MAX_BAR_ITEMS
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {barItems.length}/{MAX_BAR_ITEMS}
              </span>
            </div>
            <p className="text-xs text-gray-400 mb-3">Up to 4 items appear in the bottom navigation bar.</p>

            <SortableContext items={barItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div id="bar-droppable" className="space-y-2 min-h-[60px]">
                {barItems.map((item) => (
                  <SortableNavItem key={item.id} item={item} isBeingDragged={activeId === item.id} />
                ))}
                {barItems.length === 0 && (
                  <div className="h-14 rounded-[14px] border-2 border-dashed border-gray-200 flex items-center justify-center text-xs text-gray-400">
                    Drag items here
                  </div>
                )}
              </div>
            </SortableContext>
          </section>

          {/* More Drawer section */}
          <section className="mb-6">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">More Drawer</h3>
            <p className="text-xs text-gray-400 mb-3">These items appear in the "More" sheet.</p>

            <SortableContext items={drawerItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div id="drawer-droppable" className="space-y-2 min-h-[60px]">
                {drawerItems.map((item) => (
                  <SortableNavItem key={item.id} item={item} isBeingDragged={activeId === item.id} />
                ))}
                {drawerItems.length === 0 && (
                  <div className="h-14 rounded-[14px] border-2 border-dashed border-gray-200 flex items-center justify-center text-xs text-gray-400">
                    No items here
                  </div>
                )}
              </div>
            </SortableContext>
          </section>

          {/* Drag overlay — follows the pointer and shows a lifted card */}
          <DragOverlay dropAnimation={null}>
            {activeItem && (
              <div className="flex items-center gap-3 bg-white rounded-[14px] p-3 border border-gray-200 shadow-2xl opacity-95 select-none">
                <GripVertical size={20} className="text-gray-300" />
                <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-[#F7F6F3] flex-shrink-0">
                  <activeItem.icon size={18} style={{ color: 'var(--brand-color, #d4a017)' }} />
                </div>
                <span className="text-sm font-semibold text-gray-800">{activeItem.label}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>

        {/* Footnote */}
        <div className="bg-white rounded-[14px] p-3 border border-gray-100 text-xs text-gray-400">
          <span className="font-semibold text-gray-500">Note: </span>
          Inbox, Settings, and the "More" button are always available and cannot be rearranged.
        </div>
      </div>
    </div>
  );
};

export default AdminNavCustomizer;
