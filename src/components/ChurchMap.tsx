"use client";
import React, { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { getPlaceholderImage } from '@/utils/placeholder';
import L from 'leaflet';
import { ArrowLeft, LocateFixed, Map as MapIcon, List, Navigation, Home, CheckCircle } from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase';
import ChurchDetailsModal from './ChurchDetailsModal';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope } from '../utils/tenant-scope';



// Fix for default marker icon in react-leaflet (safe for SSR since component uses dynamic import)
if (typeof window !== 'undefined') {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  });
}

// Custom church icon
const createChurchIcon = () => {
 return L.divIcon({
 html: `<div style="background-color: #d4a017; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px rgba(0,0,0,0.3); border: 2px solid white;">
 <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 7 4 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9l4-2"/><path d="M14 22v-4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v4"/><path d="M18 22V5l-6-3-6 3v17"/><path d="M12 7v5"/><path d="M10 9h4"/></svg>
 </div>`,
 className: 'custom-church-icon',
 iconSize: [40, 40],
 iconAnchor: [20, 20],
 popupAnchor: [0, -20],
 });
};
const churchIcon = createChurchIcon();

const createUserIcon = () => {
 return L.divIcon({
 html: `<div style="background-color: #3b82f6; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.3), 0 2px 5px rgba(0,0,0,0.3); border: 3px solid white;">
 </div>`,
 className: 'custom-user-icon',
 iconSize: [20, 20],
 iconAnchor: [10, 10],
 popupAnchor: [0, -10],
 });
};
const userIcon = createUserIcon();

function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
 const R = 6371; // Radius of the earth in km
 const dLat = deg2rad(lat2-lat1);
 const dLon = deg2rad(lon2-lon1); 
 const a = 
 Math.sin(dLat/2) * Math.sin(dLat/2) +
 Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
 Math.sin(dLon/2) * Math.sin(dLon/2)
 ; 
 const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
 const d = R * c; // Distance in km
 return d;
}

function deg2rad(deg: number) {
 return deg * (Math.PI/180)
}

interface Church {
 id: string;
 name: string;
 street?: string;
 number?: string;
 city: string;
 country: string;
 pastorName: string;
 lat: number;
 lng: number;
 status: string;
 imageUrl?: string;
}

interface ChurchMapProps {
 onBack: () => void;
 onMapInteraction: (interacting: boolean) => void;
}

const LocationButton = ({ setUserLocation }: { setUserLocation: (loc: {lat: number, lng: number}) => void }) => {
 const map = useMap();

 const locateUser = () => {
 if ('geolocation' in navigator) {
 navigator.geolocation.getCurrentPosition(
 (position) => {
 const { latitude, longitude } = position.coords;
 setUserLocation({ lat: latitude, lng: longitude });
 map.flyTo([latitude, longitude], 13);
 },
 (error) => {
 console.error("Error getting location:", error);
 alert("Could not get your location. Please ensure location services are enabled.");
 },
 { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
 );
 } else {
 alert("Geolocation is not supported by your browser.");
 }
 };

 return (
 <button 
 onClick={(e) => {
 e.stopPropagation();
 locateUser();
 }}
 className="bg-white p-3 rounded-full shadow-md text-gray-700 hover:text-gold transition-colors"
 >
 <LocateFixed size={24} />
 </button>
 );
};

const MapEvents = ({ onInteraction }: { onInteraction: (interacting: boolean) => void }) => {
 const map = useMap();
 
 useEffect(() => {
 let timeoutId: NodeJS.Timeout;

 const handleInteractionStart = () => {
 clearTimeout(timeoutId);
 onInteraction(true);
 };

 const handleInteractionEnd = () => {
 timeoutId = setTimeout(() => {
 onInteraction(false);
 }, 3000);
 };
 
 map.on('mousedown', handleInteractionStart);
 map.on('touchstart', handleInteractionStart);
 map.on('dragstart', handleInteractionStart);
 
 map.on('mouseup', handleInteractionEnd);
 map.on('touchend', handleInteractionEnd);
 map.on('dragend', handleInteractionEnd);
 
 return () => {
 clearTimeout(timeoutId);
 map.off('mousedown', handleInteractionStart);
 map.off('touchstart', handleInteractionStart);
 map.off('dragstart', handleInteractionStart);
 
 map.off('mouseup', handleInteractionEnd);
 map.off('touchend', handleInteractionEnd);
 map.off('dragend', handleInteractionEnd);
 };
 }, [map, onInteraction]);

 return null;
};

const ChurchMap: React.FC<ChurchMapProps> = ({ onBack, onMapInteraction }) => {
 const [churches, setChurches] = useState<Church[]>([]);
 const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
 const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null);
 const [homeChurchId, setHomeChurchId] = useState<string | null>(null);
 const [highlightedChurchId, setHighlightedChurchId] = useState<string | null>(null);
 const [isChurchDetailsOpen, setIsChurchDetailsOpen] = useState(false);
 const [selectedChurchId, setSelectedChurchId] = useState<string | null>(null);

 useEffect(() => {
 const fetchChurches = async () => {
 try {
 const tenantId = await getTenantScope();
 // Single-field filter only (status); tenant scoping applied client-side.
 const q = query(collection(db, 'churches'), where('status', '==', 'active'));
 const querySnapshot = await getDocs(q);
 const fetchedChurches: Church[] = [];
 querySnapshot.forEach((doc) => {
 const data = doc.data();
 if (tenantId && data.tenantId !== tenantId) return;
 // Convert lat/lng to numbers if they are strings
 const lat = typeof data.lat === 'string' ? parseFloat(data.lat) : data.lat;
 const lng = typeof data.lng === 'string' ? parseFloat(data.lng) : data.lng;

 if (!isNaN(lat) && !isNaN(lng)) {
 fetchedChurches.push({ id: doc.id, ...data, lat, lng } as Church);
 }
 });
 setChurches(fetchedChurches);
 } catch (error) {
 try { handleFirestoreError(error, OperationType.GET, `churches`); } catch (e) { console.error(e); }
 }
 };
 fetchChurches();
 
 // Load home church from local storage if any
 const savedHomeChurch = localStorage.getItem('homeChurchId');
 if (savedHomeChurch) {
 setHomeChurchId(savedHomeChurch);
 }
 }, []);

 const handleSetHomeChurch = (id: string) => {
 if (homeChurchId === id) {
 setHomeChurchId(null);
 localStorage.removeItem('homeChurchId');
 } else {
 setHomeChurchId(id);
 localStorage.setItem('homeChurchId', id);
 }
 };

 const openDirections = (lat: number, lng: number) => {
 const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
 window.open(url, '_blank');
 };

 // Sort churches by distance if user location is available
 const sortedChurches = useMemo(() => [...churches].sort((a, b) => {
 if (!userLocation) return 0;
 const distA = getDistanceFromLatLonInKm(userLocation.lat, userLocation.lng, a.lat, a.lng);
 const distB = getDistanceFromLatLonInKm(userLocation.lat, userLocation.lng, b.lat, b.lng);
 return distA - distB;
 }), [churches, userLocation]);

 useEffect(() => {
 if (viewMode === 'list' && highlightedChurchId) {
 const element = document.getElementById(`church-card-${highlightedChurchId}`);
 if (element) {
 setTimeout(() => {
 element.scrollIntoView({ behavior: 'smooth', block: 'center' });
 }, 100);
 }
 }
 }, [viewMode, highlightedChurchId]);

 const handleMarkerClick = (churchId: string) => {
 setHighlightedChurchId(churchId);
 setViewMode('list');
 };

 return (
 <div className="relative w-full h-full bg-[#f8f9fa] flex flex-col">
 {/* Top Controls */}
 <div className="absolute top-4 left-4 right-4 z-[1000] flex justify-between items-center pointer-events-none">
 <button 
 onClick={onBack}
 className="pointer-events-auto bg-white p-3 rounded-full shadow-md text-gray-700 hover:text-gold transition-colors"
 >
 <ArrowLeft size={24} />
 </button>

 {viewMode === 'list' && (
 <h2 className="text-xl font-bold text-gray-900 pointer-events-auto font-display">
 Churches near you
 </h2>
 )}

 <div className="flex flex-col gap-2 pointer-events-auto lg:hidden">
 <button 
 onClick={() => setViewMode(viewMode === 'map' ? 'list' : 'map')}
 className="bg-white p-3 rounded-full shadow-md text-gray-700 hover:text-gold transition-colors flex items-center justify-center"
 >
 {viewMode === 'map' ? <List size={24} /> : <MapIcon size={24} />}
 </button>
 </div>
 </div>

 {/* Map is always mounted (never display:none) so leaflet keeps its size */}
 <MapContainer
 center={[20, 0]}
 zoom={2} 
 style={{ height: '100%', width: '100%', zIndex: 0 }}
 zoomControl={false}
 attributionControl={false}
 >
 <TileLayer
 url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
 />
 <div className="absolute top-20 right-4 z-[1000]">
 <LocationButton setUserLocation={setUserLocation} />
 </div>
 <MapEvents onInteraction={onMapInteraction} />
 
 {userLocation && (
 <Marker position={[userLocation.lat, userLocation.lng]} icon={userIcon}>
 <Popup>You are here</Popup>
 </Marker>
 )}

 {churches.map((church) => (
 <Marker 
 key={church.id} 
 position={[church.lat, church.lng]}
 icon={churchIcon}
 eventHandlers={{
 click: () => handleMarkerClick(church.id)
 }}
 >
 </Marker>
 ))}
 </MapContainer>

 {/* Church list — full-screen overlay on mobile (list mode); fixed left panel on desktop */}
 <div className={`${viewMode === 'list' ? 'block' : 'hidden'} lg:block absolute inset-0 lg:inset-y-0 lg:left-0 lg:right-auto lg:w-[380px] bg-white overflow-y-auto pt-24 lg:pt-20 px-4 pb-6 z-[500] lg:shadow-[4px_0_16px_rgba(0,0,0,0.06)]`}>
 <div className="w-full max-w-2xl mx-auto lg:max-w-none lg:mx-0">
 <div className="space-y-4">
 {sortedChurches.map((church) => {
 let distanceStr = "? km";
 if (userLocation) {
 const dist = getDistanceFromLatLonInKm(userLocation.lat, userLocation.lng, church.lat, church.lng);
 distanceStr = dist < 10 ? dist.toFixed(1) + " km" : Math.round(dist) + " km";
 }

 const isHome = homeChurchId === church.id;
 const isHighlighted = highlightedChurchId === church.id;

 return (
 <div 
 key={church.id} 
 id={`church-card-${church.id}`}
 onClick={() => {
 setSelectedChurchId(church.id);
 setIsChurchDetailsOpen(true);
 }}
 className={`bg-white rounded-2xl p-3 flex gap-3 shadow-sm transition-all duration-500 cursor-pointer ${
 isHighlighted 
 ? 'border-2 border-gold ring-4 ring-[color-mix(in_srgb,var(--brand-color)_20%,transparent)] scale-[1.02]' 
 : 'border border-gray-100 '
 }`}
 >
 <div className="w-20 h-20 rounded-xl bg-gray-200 flex-shrink-0 overflow-hidden relative">
 {/* Placeholder image for church */}
 <Image 
 src={church.imageUrl || getPlaceholderImage(church.id, 200, 200)} 
 alt={church.name}
 fill
 sizes="80px"
 className="object-cover"
 referrerPolicy="no-referrer"
 />
 </div>
 
 <div className="flex-1 flex flex-col justify-between py-0.5">
 <div>
 <div className="flex justify-between items-start">
 <h3 className="font-bold text-base text-gray-900 flex items-center gap-1 leading-tight">
 {church.name}
 <CheckCircle size={12} className="text-gold flex-shrink-0" />
 </h3>
 <span className="text-xs font-semibold text-gray-400 whitespace-nowrap ml-2">
 {distanceStr}
 </span>
 </div>
 <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
 {church.street} {church.number && church.number !== '' ? church.number : ''}
 {church.street ? ', ' : ''}
 {church.city}, {church.country}
 </p>
 </div>

 <div className="flex items-center justify-between mt-2">
 <button 
 onClick={(e) => {
 e.stopPropagation();
 handleSetHomeChurch(church.id);
 }}
 className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors shadow-sm ${
 isHome 
 ? 'bg-[#1e3a8a] text-white' 
 : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50 :bg-gray-700'
 }`}
 title={isHome ? 'Remove from Home Church' : 'Set as Home Church'}
 >
 <Home size={16} />
 </button>

 <div className="flex items-center gap-1.5">
 <button 
 onClick={(e) => {
 e.stopPropagation();
 setSelectedChurchId(church.id);
 setIsChurchDetailsOpen(true);
 }}
 className="w-8 h-8 rounded-lg bg-gold flex items-center justify-center shadow-sm hover:bg-[color-mix(in_srgb,var(--brand-color)_85%,black)] transition-colors text-white"
 title="Church Information"
 >
 <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 7 4 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9l4-2"/><path d="M14 22v-4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v4"/><path d="M18 22V5l-6-3-6 3v17"/><path d="M12 7v5"/><path d="M10 9h4"/></svg>
 </button>
 </div>
 </div>
 </div>
 </div>
 );
 })}
 
 {churches.length === 0 && (
 <div className="text-center py-12">
 <p className="text-gray-500 ">No verified churches found in your area.</p>
 </div>
 )}
 </div>
 </div>
 </div>

 <ChurchDetailsModal
 isOpen={isChurchDetailsOpen}
 onClose={() => setIsChurchDetailsOpen(false)}
 churchId={selectedChurchId}
 isHomeChurch={homeChurchId === selectedChurchId}
 onRemoveHomeChurch={() => {
 setHomeChurchId(null);
 localStorage.removeItem('homeChurchId');
 }}
 />
 </div>
 );
};

export default ChurchMap;