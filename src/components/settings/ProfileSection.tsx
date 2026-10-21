"use client";

import React, { useEffect, useRef, useState } from 'react';
import { updatePassword, updateProfile, signOut, EmailAuthProvider, reauthenticateWithCredential, sendPasswordResetEmail } from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../../firebase';
import { authFetch } from '../../utils/auth-fetch';
import { OperationType, handleFirestoreError } from '../../utils/firestore-errors';
import { DELETE_CONFIRM_COPY, UNREACHABLE_NOTE } from '../../lib/member-erasure-copy';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ACTION_BUTTON, CONTROL_DENSITY } from '../layout/form-layout';

const TOUCH_FLOOR = 'min-h-11 sm:min-h-0';

type PasswordFlow = 'idle' | 'current' | 'new' | 'forgot';
type DeleteFlow = 'idle' | 'deleting' | 'reauth' | 'error' | 'done';

/**
 * Signed-in admin identity for the Settings popup Profile pane.
 *
 * Name, email, photo and password change, plus Export my data and Delete
 * account. Routes and confirm copy are the ones PersonalInformationModal
 * already uses — `/api/account/export`, `/api/account/delete`,
 * `DELETE_CONFIRM_COPY`. The backend is not touched.
 */
export default function ProfileSection() {
  const [name, setName] = useState(auth.currentUser?.displayName || '');
  const [email, setEmail] = useState(auth.currentUser?.email || '');
  const [photo, setPhoto] = useState<string | null>(auth.currentUser?.photoURL || null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [passwordFlow, setPasswordFlow] = useState<PasswordFlow>('idle');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [exportState, setExportState] = useState<'idle' | 'working' | 'error'>('idle');
  const [exportMessage, setExportMessage] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteState, setDeleteState] = useState<DeleteFlow>('idle');
  const [deleteMessage, setDeleteMessage] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  // React 18 does not forward `ref` through the pinned Input primitive, so the
  // picker is reached through its wrapper.
  const fileInputWrapRef = useRef<HTMLDivElement>(null);
  const openPhotoPicker = () => fileInputWrapRef.current?.querySelector('input')?.click();

  const isEmailAuth = auth.currentUser?.providerData?.some((p) => p.providerId === 'password');

  useEffect(() => {
    setName(auth.currentUser?.displayName || '');
    setEmail(auth.currentUser?.email || '');
    setPhoto(auth.currentUser?.photoURL || null);
    if (!auth.currentUser) return;
    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', auth.currentUser!.uid));
        if (snap.exists()) {
          const data = snap.data();
          if (data.displayName) setName(data.displayName);
          if (data.photoURL) setPhoto(data.photoURL);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `users/${auth.currentUser?.uid}`);
      }
    })();
  }, []);

  const handleSave = async () => {
    if (!auth.currentUser) {
      setSaveState('error');
      setSaveMessage('You are not signed in. Sign in again and retry.');
      return;
    }
    setSaveState('saving');
    setSaveMessage('');
    try {
      await updateProfile(auth.currentUser, { displayName: name });
    } catch {
      setSaveState('error');
      setSaveMessage('Your name could not be saved to your sign-in. Nothing was changed — please try again.');
      return;
    }
    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid), { displayName: name });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${auth.currentUser.uid}`);
      setSaveState('error');
      setSaveMessage('Your details could not be saved. Your changes are still here — check your connection and try again.');
      return;
    }
    setSaveState('idle');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !auth.currentUser) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      const img = new window.Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const MAX = 400;
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > MAX) { height *= MAX / width; width = MAX; }
        } else if (height > MAX) {
          width *= MAX / height;
          height = MAX;
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
        const base64String = canvas.toDataURL('image/jpeg', 0.7);
        const previousPhoto = photo;
        setPhoto(base64String);
        try {
          const uid = auth.currentUser?.uid;
          if (!uid) throw new Error('not signed in');
          await updateDoc(doc(db, 'users', uid), { photoURL: base64String });
          if (auth.currentUser) {
            try { await updateProfile(auth.currentUser, { photoURL: base64String }); }
            catch (err) { console.warn('Could not update auth profile photoURL, but saved to Firestore', err); }
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, `users/${auth.currentUser?.uid}`);
          setPhoto(previousPhoto);
          setSaveState('error');
          setSaveMessage('Your photo could not be saved. Your previous photo is still in place — check your connection and try again.');
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleExportData = async () => {
    if (!auth.currentUser) {
      setExportState('error');
      setExportMessage('You are not signed in. Sign in again and retry.');
      return;
    }
    setExportState('working');
    setExportMessage('');
    const uid = auth.currentUser.uid;
    let res: Response;
    let data: { format?: string; status?: string; error?: string };
    try {
      await auth.currentUser.getIdToken(true);
      res = await authFetch('/api/account/export', {
        method: 'POST',
        body: JSON.stringify({ userId: uid }),
      });
      data = await res.json().catch(() => ({}));
    } catch {
      setExportState('error');
      setExportMessage('Could not reach the server. Check your connection and try again.');
      return;
    }
    if (data?.format === 'harvest.member-export') {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `harvest-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    }
    if (res.ok) {
      setExportState('idle');
      setExportMessage('Your data has been downloaded.');
      return;
    }
    setExportState('error');
    setExportMessage(data?.error || 'Export failed. Try again.');
  };

  const resetDelete = () => {
    setShowDeleteConfirm(false);
    setDeleteState('idle');
    setDeleteMessage('');
    setDeletePassword('');
  };

  const handleDeleteAccount = async () => {
    if (!auth.currentUser) {
      setDeleteState('error');
      setDeleteMessage('You are not signed in.');
      return;
    }
    setDeleteState('deleting');
    setDeleteMessage('');
    try {
      await auth.currentUser.getIdToken(true);
      const res = await authFetch('/api/account/delete', {
        method: 'POST',
        body: JSON.stringify({ userId: auth.currentUser.uid }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDeleteState('done');
        setDeleteMessage('Your account and sign-in have been deleted. Signing you out now.');
        signOut(auth).catch((err) => console.error('Error signing out after delete:', err));
        return;
      }
      if (data?.code === 'auth/requires-recent-login') {
        if (isEmailAuth) {
          setDeleteState('reauth');
          setDeleteMessage('For your security, confirm your password to finish deleting your account.');
        } else {
          setDeleteState('error');
          setDeleteMessage('For your security, this needs a recent sign-in. Sign out, sign back in, and delete your account within a few minutes.');
        }
        return;
      }
      setDeleteState('error');
      setDeleteMessage(data?.error || 'Delete failed. Try again.');
    } catch {
      setDeleteState('error');
      setDeleteMessage('Could not reach the server. Check your connection and try again.');
    }
  };

  const handleReauthAndDelete = async () => {
    if (!auth.currentUser || !deletePassword) {
      setDeleteMessage('Enter your password to continue.');
      return;
    }
    try {
      const cred = EmailAuthProvider.credential(auth.currentUser.email || '', deletePassword);
      await reauthenticateWithCredential(auth.currentUser, cred);
      await handleDeleteAccount();
    } catch {
      setDeleteMessage('Incorrect password. Try again.');
    }
  };

  const submitPassword = async () => {
    if (!auth.currentUser) return;
    setPasswordBusy(true);
    setPasswordMessage('');
    try {
      if (passwordFlow === 'current') {
        const cred = EmailAuthProvider.credential(auth.currentUser.email || '', currentPassword);
        await reauthenticateWithCredential(auth.currentUser, cred);
        setPasswordFlow('new');
      } else if (passwordFlow === 'new') {
        if (newPassword !== confirmNewPassword) {
          setPasswordMessage('New passwords do not match.');
        } else {
          await updatePassword(auth.currentUser, newPassword);
          setPasswordMessage('Password updated.');
          setPasswordFlow('idle');
          setCurrentPassword('');
          setNewPassword('');
          setConfirmNewPassword('');
        }
      } else if (passwordFlow === 'forgot') {
        if (auth.currentUser.email) {
          await sendPasswordResetEmail(auth, auth.currentUser.email);
          setPasswordMessage('Reset link sent.');
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update password.';
      setPasswordMessage(message);
    } finally {
      setPasswordBusy(false);
    }
  };

  const initial = (name || email || 'A').charAt(0).toUpperCase();

  return (
    <div className="space-y-6" data-settings-section="profile">
      {saveState === 'error' && (
        <Alert variant="destructive" aria-live="assertive">
          <AlertTitle>Your changes were not saved</AlertTitle>
          <AlertDescription>{saveMessage}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-4">
        <Button
          type="button"
          variant="ghost"
          onClick={openPhotoPicker}
          className={`h-auto w-auto shrink-0 rounded-full p-0 ${TOUCH_FLOOR}`}
          aria-label="Change photo"
        >
          <Avatar size="lg">
            <AvatarImage src={photo || undefined} alt={name || 'Profile'} />
            <AvatarFallback>{initial}</AvatarFallback>
          </Avatar>
        </Button>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-strong truncate">{name || 'Admin'}</p>
          <p className="text-xs text-muted truncate">{email}</p>
          <Button
            type="button"
            variant="ghost"
            onClick={openPhotoPicker}
            className={`mt-1 h-auto px-0 text-xs font-semibold text-gold ${TOUCH_FLOOR} ${CONTROL_DENSITY.action}`}
          >
            Change photo
          </Button>
        </div>
        <div ref={fileInputWrapRef} className="hidden">
          <Input type="file" accept="image/*" tabIndex={-1} aria-label="Photo file" onChange={handleFileChange} />
        </div>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="settings-profile-name">Name</Label>
          <Input
            id="settings-profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`${TOUCH_FLOOR} ${CONTROL_DENSITY.control}`}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="settings-profile-email">Email</Label>
          <Input
            id="settings-profile-email"
            type="email"
            value={email}
            readOnly
            className={`${TOUCH_FLOOR} ${CONTROL_DENSITY.control} cursor-not-allowed text-muted`}
          />
        </div>
        <Button
          type="button"
          onClick={handleSave}
          disabled={saveState === 'saving'}
          className={`${TOUCH_FLOOR} ${ACTION_BUTTON} ${CONTROL_DENSITY.action}`}
        >
          {saveState === 'saving' ? 'Saving…' : 'Save name'}
        </Button>
      </div>

      {isEmailAuth && (
        <div className="space-y-3">
          <Separator />
          {passwordFlow === 'idle' ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => { setPasswordFlow('current'); setPasswordMessage(''); }}
              className={`w-full justify-between ${TOUCH_FLOOR} ${CONTROL_DENSITY.action}`}
            >
              Change password
            </Button>
          ) : (
            <div className="space-y-2 rounded-xl border border-line p-3">
              {passwordFlow === 'current' && (
                <Input
                  type="password"
                  placeholder="Current password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className={`${TOUCH_FLOOR} ${CONTROL_DENSITY.control}`}
                  aria-label="Current password"
                />
              )}
              {passwordFlow === 'new' && (
                <>
                  <Input
                    type="password"
                    placeholder="New password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className={`${TOUCH_FLOOR} ${CONTROL_DENSITY.control}`}
                    aria-label="New password"
                  />
                  <Input
                    type="password"
                    placeholder="Confirm new password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    className={`${TOUCH_FLOOR} ${CONTROL_DENSITY.control}`}
                    aria-label="Confirm new password"
                  />
                </>
              )}
              {passwordFlow === 'forgot' && (
                <p className="text-sm text-muted">We will send a password reset link to your email address.</p>
              )}
              {passwordMessage && (
                <p className="text-xs text-muted">{passwordMessage}</p>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { setPasswordFlow('idle'); setPasswordMessage(''); }}
                  className={`${TOUCH_FLOOR} ${CONTROL_DENSITY.action}`}
                >
                  Cancel
                </Button>
                {passwordFlow === 'current' && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setPasswordFlow('forgot')}
                    className={`${TOUCH_FLOOR} ${CONTROL_DENSITY.action}`}
                  >
                    Forgot
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={submitPassword}
                  disabled={passwordBusy}
                  className={`${TOUCH_FLOOR} ${ACTION_BUTTON} ${CONTROL_DENSITY.action}`}
                >
                  {passwordBusy ? 'Working…' : passwordFlow === 'forgot' ? 'Send reset' : 'Continue'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <Separator />

      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleExportData}
          disabled={exportState === 'working'}
          className={`w-full justify-between ${TOUCH_FLOOR} ${CONTROL_DENSITY.action}`}
        >
          {exportState === 'working' ? 'Preparing your download…' : 'Export my data'}
        </Button>
        {exportMessage && (
          <p role={exportState === 'error' ? 'alert' : 'status'} className="text-xs text-muted">
            {exportMessage}
          </p>
        )}

        {showDeleteConfirm ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 space-y-3">
            {deleteState === 'done' ? (
              <p role="status" className="text-sm font-semibold text-strong">{deleteMessage}</p>
            ) : (
              <>
                <p className="text-sm font-semibold text-destructive">Are you sure? This cannot be undone.</p>
                <div className="text-xs text-body flex flex-col gap-3 text-left">
                  {DELETE_CONFIRM_COPY.groups.map((group) => (
                    <div key={group.disposition} className="flex flex-col gap-1">
                      <span className="text-xs font-bold text-strong">{group.heading}</span>
                      <span>{group.blurb}</span>
                      <ul className="list-disc ps-4 flex flex-col gap-0.5">
                        {group.items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  {DELETE_CONFIRM_COPY.unreachable.length > 0 && (
                    <span>
                      {UNREACHABLE_NOTE}{' '}
                      {DELETE_CONFIRM_COPY.unreachable.join('; ')}.
                    </span>
                  )}
                </div>
                {deleteMessage && (
                  <p role="alert" className="text-xs">{deleteMessage}</p>
                )}
                {deleteState === 'reauth' && (
                  <Input
                    type="password"
                    aria-label="Password"
                    placeholder="Password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    className={`${TOUCH_FLOOR} ${CONTROL_DENSITY.control}`}
                  />
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetDelete}
                    disabled={deleteState === 'deleting'}
                    className={`flex-1 ${TOUCH_FLOOR} ${CONTROL_DENSITY.action}`}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={deleteState === 'reauth' ? handleReauthAndDelete : handleDeleteAccount}
                    disabled={deleteState === 'deleting'}
                    className={`flex-1 ${TOUCH_FLOOR} ${CONTROL_DENSITY.action}`}
                  >
                    {deleteState === 'deleting' ? 'Deleting…' : deleteState === 'reauth' ? 'Confirm & Delete' : 'Delete account'}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
          <Button
            type="button"
            variant="destructive"
            onClick={() => setShowDeleteConfirm(true)}
            className={`w-full ${TOUCH_FLOOR} ${CONTROL_DENSITY.action}`}
          >
            Delete account
          </Button>
        )}
      </div>
    </div>
  );
}
