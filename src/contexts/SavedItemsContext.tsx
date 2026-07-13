'use client';
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { doc, onSnapshot, updateDoc, deleteField } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '../firebase';
import { SavedEntry, SavedEntryInput, keyForEntry } from '../types/saved.types';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';

/**
 * Single subscription to the current user's `savedItems` map (a field on
 * users/{uid}). Provided app-wide so the many save toggles (a Bible chapter can
 * render ~30 verses) share ONE Firestore listener instead of each opening their
 * own. Writes go through a dotted field path — `savedItems.<key>` — to add or
 * remove exactly one key, mirroring lessonNotes/quizAttempts in CoursePage.tsx.
 *
 * Saves live on the user's own global users/{uid} doc — private to the user,
 * no tenant scoping.
 */
export interface SavedItemsContextValue {
  /** The user's savedItems map (key → entry). Empty until loaded / when signed out. */
  savedItems: Record<string, SavedEntry>;
  /** True once the user doc has been read at least once. */
  ready: boolean;
  /** Whether a given composite key is currently saved. */
  isSaved: (key: string) => boolean;
  /** Toggle a save on/off (optimistic local update + dotted-path write). */
  toggleSave: (entry: SavedEntryInput) => void;
  /** Remove a save by its composite key (used by the Saved list's unsave control). */
  removeSave: (key: string) => void;
}

// Safe no-op default so a SaveButton rendered outside a provider (or before auth
// resolves) degrades to "not saved" instead of throwing.
const defaultValue: SavedItemsContextValue = {
  savedItems: {},
  ready: false,
  isSaved: () => false,
  toggleSave: () => {},
  removeSave: () => {},
};

const SavedItemsContext = createContext<SavedItemsContextValue>(defaultValue);

export const SavedItemsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [savedItems, setSavedItems] = useState<Record<string, SavedEntry>>({});
  const [ready, setReady] = useState(false);
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);

  // Track the signed-in user; reset state on sign-out.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUid(user?.uid ?? null);
      if (!user) {
        setSavedItems({});
        setReady(false);
      }
    });
    return () => unsub();
  }, []);

  // Subscribe to the user doc's savedItems field.
  useEffect(() => {
    if (!uid) return;
    const userRef = doc(db, 'users', uid);
    const unsub = onSnapshot(
      userRef,
      (snap) => {
        const data = snap.data();
        setSavedItems((data?.savedItems as Record<string, SavedEntry>) || {});
        setReady(true);
      },
      (error) => {
        try { handleFirestoreError(error, OperationType.GET, `users/${uid}`); } catch (e) { console.error(e); }
        setReady(true);
      }
    );
    return () => unsub();
  }, [uid]);

  const isSaved = useCallback((key: string) => Boolean(savedItems[key]), [savedItems]);

  const toggleSave = useCallback((input: SavedEntryInput) => {
    const user = auth.currentUser;
    if (!user) return;
    const key = keyForEntry(input);
    const currentlySaved = Boolean(savedItems[key]);
    const userRef = doc(db, 'users', user.uid);

    if (currentlySaved) {
      // Optimistic remove.
      setSavedItems((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      updateDoc(userRef, { [`savedItems.${key}`]: deleteField() }).catch((error) => {
        try { handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`); } catch (e) { console.error(e); }
      });
    } else {
      const entry = { ...input, savedAt: new Date().toISOString() } as SavedEntry;
      // Optimistic add.
      setSavedItems((prev) => ({ ...prev, [key]: entry }));
      updateDoc(userRef, { [`savedItems.${key}`]: entry }).catch((error) => {
        try { handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`); } catch (e) { console.error(e); }
      });
    }
  }, [savedItems]);

  const removeSave = useCallback((key: string) => {
    const user = auth.currentUser;
    if (!user) return;
    setSavedItems((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    const userRef = doc(db, 'users', user.uid);
    updateDoc(userRef, { [`savedItems.${key}`]: deleteField() }).catch((error) => {
      try { handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`); } catch (e) { console.error(e); }
    });
  }, []);

  return (
    <SavedItemsContext.Provider value={{ savedItems, ready, isSaved, toggleSave, removeSave }}>
      {children}
    </SavedItemsContext.Provider>
  );
};

export const useSavedItems = (): SavedItemsContextValue => useContext(SavedItemsContext);
