"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { auth, db } from '../firebase';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import CountrySelect from './CountrySelect';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface OnboardingProps {
  onComplete: () => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Pre-fill name if available from Google
    if (auth.currentUser?.displayName) {
      setName(auth.currentUser.displayName);
    }

    // Auto-attempt to get location
    if (navigator.geolocation) {
      setGpsLoading(true);
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            const { latitude, longitude } = position.coords;
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
            const data = await response.json();
            
            if (data && data.address) {
              const foundCountry = data.address.country || '';
              const foundCity = data.address.city || data.address.town || data.address.village || data.address.county || '';
              
              if (foundCountry) setCountry(foundCountry);
              if (foundCity) setCity(foundCity);
            }
          } catch (err) {
            console.error("Error fetching location data:", err);
          } finally {
            setGpsLoading(false);
          }
        },
        (err) => {
          console.error("Geolocation error:", err);
          setGpsLoading(false);
        }
      );
    }
  }, []);

  const handleUseGPS = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser.');
      return;
    }

    setGpsLoading(true);
    setError('');

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
          const data = await response.json();
          
          if (data && data.address) {
            const foundCountry = data.address.country || '';
            const foundCity = data.address.city || data.address.town || data.address.village || data.address.county || '';
            
            if (foundCountry) setCountry(foundCountry);
            if (foundCity) setCity(foundCity);
          }
        } catch (err) {
          console.error("Error fetching location data:", err);
          setError('Failed to get location details from GPS.');
        } finally {
          setGpsLoading(false);
        }
      },
      (err) => {
        console.error("Geolocation error:", err);
        setError('Failed to get your location. Please ensure location permissions are granted.');
        setGpsLoading(false);
      }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !country || !city) {
      setError('Please fill in all fields.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      
      const user = auth.currentUser;
      if (!user) throw new Error('No user logged in');

      const userRef = doc(db, 'users', user.uid);
      try {
        await updateDoc(userRef, {
          displayName: name,
          country,
          city,
          onboardingCompleted: true
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
        return;
      }

      onComplete();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to save information.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background-dark px-4 py-12 relative overflow-hidden">
      {/* Background Image & Overlay */}
      <div className="absolute inset-0 z-0">
        <Image 
          src="https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/No_people_just_2k_202512231746.jpeg" 
          alt="Harvest Background" 
          fill
          sizes="100vw"
          priority
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background-dark/80 via-background-dark/60 to-background-dark/95 mix-blend-multiply"></div>
        <div className="absolute inset-0 bg-black/40"></div>
      </div>

      <div className="max-w-md w-full bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl shadow-2xl overflow-hidden z-10 relative">
        <div className="p-8 sm:p-12">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-black text-white mb-2">Let&apos;s get started!</h1>
            <p className="text-gray-300 text-sm mb-4">
              We need a little more info so you can get personalized announcements and posts based on your city.
            </p>
            <button
              type="button"
              onClick={handleUseGPS}
              disabled={gpsLoading}
              className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white text-sm font-medium py-2 px-4 rounded-full transition-colors disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-sm">my_location</span>
              {gpsLoading ? 'Locating...' : 'Use my current location'}
            </button>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-500/20 border-l-4 border-red-500 text-red-100 text-sm rounded backdrop-blur-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-gray-200 mb-1">Full Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
                placeholder="John Doe"
              />
            </div>

            <div className="relative z-50">
              <label className="block text-sm font-bold text-gray-200 mb-1">Country</label>
              <CountrySelect
                value={country}
                onChange={setCountry}
                className="w-full"
                buttonClassName="!bg-white/5 !border-white/20 !text-white focus:!ring-2 focus:!ring-primary focus:!border-primary !py-3 !rounded-xl"
              />
            </div>

            <div className="relative z-40">
              <label className="block text-sm font-bold text-gray-200 mb-1">City</label>
              <input
                type="text"
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
                placeholder="e.g. London"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-white font-bold py-3 px-4 rounded-xl hover:bg-yellow-600 transition-all duration-100 shadow-lg shadow-primary/30 disabled:opacity-50 mt-4"
            >
              {loading ? 'Saving...' : 'Continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;