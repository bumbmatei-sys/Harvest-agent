"use client";
import React, { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { getPlaceholderImage } from '@/utils/placeholder';
import { useResolvedTheme } from '@/lib/use-resolved-theme';
import L from 'leaflet';
import { ArrowLeft, LocateFixed, Map as MapIcon, List, Navigation, Home, CheckCircle, ChevronLeft } from 'lucide-react';
import { collection, query, where } from 'firebase/firestore';
import { readBoundedList, truncationNotice } from '../utils/bounded-list-read';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { db, auth } from '../firebase';
import ChurchDetailsModal from './ChurchDetailsModal';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope } from '../utils/tenant-scope';



/**
 * THE-342 — how many active churches the finder loads in one read.
 *
 * Paired ALWAYS with an exact `getCountFromServer` total and an on-screen
 * notice when it bites, so this is a limit the visitor can SEE rather than a
 * silent truncation. A bare `limit()` here would be the same defect in a
 * smaller costume.
 *
 * This is a stopgap shape, not the end state: a church-finder ultimately
 * wants a geographic bound (a geohash range scan), which needs a backfill and
 * an index this repo cannot deploy. See the comment on the read itself.
 */
export const CHURCH_MAP_FETCH_LIMIT = 500;

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

const LocationButton = ({ map, setUserLocation }: { map: L.Map; setUserLocation: (loc: {lat: number, lng: number}) => void }) => {
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
 className="bg-surface-raised p-3 rounded-full shadow-md text-body hover:text-gold transition-colors"
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

// Lift the Leaflet map instance up to the parent so controls can live outside
// the MapContainer (stable positioning, no react-leaflet child-render quirks).
const MapReady = ({ onReady }: { onReady: (map: L.Map) => void }) => {
 const map = useMap();
 useEffect(() => {
 onReady(map);
 }, [map, onReady]);
 return null;
};

/**
 * THE-346 — ONE WORLD, and the latitudes Web Mercator can actually draw.
 *
 * THE LATITUDE IS 85.0511, NOT 90. Web Mercator's y grows without bound as
 * latitude approaches the poles, so the projection is cut at the latitude that
 * makes the world SQUARE — ±85.05112878 — and that is the edge tiles exist up
 * to. Writing ±90 here would ask Leaflet to fit a strip of map that has no
 * tiles, and `getBoundsZoom` would answer with a floor one step too low, which
 * is the void this constant exists to remove.
 */
const WORLD_BOUNDS: L.LatLngBoundsExpression = [[-85.05112878, -180], [85.05112878, 180]];

const ChurchMap: React.FC<ChurchMapProps> = ({ onBack, onMapInteraction }) => {
 // Tiles are images, not CSS, so they cannot react to a variable changing —
 // the basemap has to be swapped in JS when the theme flips.
 const mapTheme = useResolvedTheme();
 const [churches, setChurches] = useState<Church[]>([]);
 // THE-342 — the two facts the finder must be able to state about its own read.
 // `churchesFailed` is NOT "no churches near you"; `churchesTruncated` carries
 // the "Showing N of M" line when the ceiling bites.
 const [churchesFailed, setChurchesFailed] = useState(false);
 const [churchesTruncated, setChurchesTruncated] = useState<string | null>(null);
 const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
 const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null);
 const [homeChurchId, setHomeChurchId] = useState<string | null>(null);
 const [highlightedChurchId, setHighlightedChurchId] = useState<string | null>(null);
 const [isChurchDetailsOpen, setIsChurchDetailsOpen] = useState(false);
 const [selectedChurchId, setSelectedChurchId] = useState<string | null>(null);
 const [listCollapsed, setListCollapsed] = useState(false);
 const [mapRef, setMapRef] = useState<L.Map | null>(null);

 /**
  * THE-346 — RAISE THE ZOOM FLOOR TO WHATEVER FITS THIS CONTAINER.
  *
  * `minZoom={2}` on the MapContainer is the declared floor and it is a real
  * one — it is what stops zoom 0 and 1 outright, and it holds before this
  * effect has ever run. What it cannot be is CORRECT AT EVERY WIDTH, because
  * the zoom at which one world fills the viewport depends on the viewport:
  * 256·2^2 = 1024px of world covers a 380px phone four times over and falls
  * 416px short of a 1440px desktop, which is the grey void again.
  *
  * `getBoundsZoom(WORLD_BOUNDS)` asks Leaflet the question directly — "what is
  * the largest zoom at which this whole box still fits" — so the floor tracks
  * the container instead of a breakpoint table, and the ticket's warning that
  * width is not monotonic stops mattering: nothing here is indexed by width.
  *
  * IT ONLY EVER RAISES. `Math.max` against the declared floor means a very
  * small container can never talk the map BELOW 2, so the static prop stays the
  * guarantee and this is a tightening of it.
  *
  * AND IT RE-RUNS ON RESIZE, because a rotated phone or a dragged desktop
  * window changes the answer. Leaflet fires `resize` for exactly this. If the
  * map is already sitting below the new floor — zoomed out on a narrow window,
  * then widened — `setZoom` walks it back up, since a floor that is not
  * enforced on the CURRENT view only applies to the next gesture.
  */
 useEffect(() => {
 if (!mapRef) return;
 const applyFloor = () => {
 const fits = mapRef.getBoundsZoom(WORLD_BOUNDS, true);
 if (!Number.isFinite(fits)) return;
 const floor = Math.max(2, Math.ceil(fits));
 mapRef.setMinZoom(floor);
 if (mapRef.getZoom() < floor) mapRef.setZoom(floor);
 };
 applyFloor();
 mapRef.on('resize', applyFloor);
 return () => { mapRef.off('resize', applyFloor); };
 }, [mapRef]);

 useEffect(() => {
 const fetchChurches = async () => {
 try {
 const tenantId = await getTenantScope();
 // Single-field filter only (status); tenant scoping applied client-side.
 //
 // THE-342 — this read had NO limit and NO order: every active church on
 // Earth, fetched in full on every visit to the public church-finder, then
 // filtered client-side by distance. It grows with every customer Harvest
 // ever signs, so the cost of opening this screen grows with the business.
 //
 // Bounded, NOT geohashed, and that is a deliberate and reported call.
 // A real geo query wants a geohash column and a range scan over it, which
 // needs a backfill of every existing church document and a composite
 // index — and firestore.indexes.json is NOT deployed by deploy-rules.yml,
 // so that index would be inert and the query would throw
 // failed-precondition in production. That is its own ticket with its own
 // migration, not a change to bundle here. What this does instead is make
 // the read BOUNDED and its incompleteness VISIBLE, which is the part that
 // is wrong today.
 //
 // The `where('status','==','active')` equality plus orderBy(documentId())
 // is a prefix scan of the automatic (status, __name__) index, so NO
 // COMPOSITE INDEX is added or needed.
 const read = await readBoundedList(
 query(collection(db, 'churches'), where('status', '==', 'active')),
 CHURCH_MAP_FETCH_LIMIT,
 (id, data) => ({ id, ...data }),
 );
 const fetchedChurches: Church[] = [];
 read.rows.forEach((row) => {
 const data = row as Record<string, unknown>;
 if (tenantId && data.tenantId !== tenantId) return;
 // Convert lat/lng to numbers if they are strings
 const lat = typeof data.lat === 'string' ? parseFloat(data.lat) : (data.lat as number);
 const lng = typeof data.lng === 'string' ? parseFloat(data.lng) : (data.lng as number);

 if (!isNaN(lat) && !isNaN(lng)) {
 fetchedChurches.push({ ...row, lat, lng } as Church);
 }
 });
 setChurches(fetchedChurches);
 setChurchesTruncated(read.truncated
 ? truncationNotice(read.rows.length, read.total, 'active churches')
 : null);
 setChurchesFailed(false);
 } catch (error) {
 try { handleFirestoreError(error, OperationType.GET, `churches`); } catch (e) { console.error(e); }
 // An empty church map reads as "no churches near you", which is a lie
 // if the query threw. The failure gets its own state and its own words.
 setChurchesFailed(true);
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
 <div className="relative w-full h-full bg-surface flex flex-col">
 {/* Top Controls */}
 <div className="lg:hidden absolute top-4 left-4 right-4 z-[1000] flex justify-between items-center pointer-events-none">
 <button 
 onClick={onBack}
 className="pointer-events-auto bg-surface-raised p-3 rounded-full shadow-md text-body hover:text-gold transition-colors"
 >
 <ArrowLeft size={24} />
 </button>

 {viewMode === 'list' && (
 <h2 className="text-xl font-bold text-strong pointer-events-auto font-display">
 Churches near you
 </h2>
 )}

 <div className="flex flex-col gap-2 pointer-events-auto lg:hidden">
 <button 
 onClick={() => setViewMode(viewMode === 'map' ? 'list' : 'map')}
 className="bg-surface-raised p-3 rounded-full shadow-md text-body hover:text-gold transition-colors flex items-center justify-center"
 >
 {viewMode === 'map' ? <List size={24} /> : <MapIcon size={24} />}
 </button>
 </div>
 </div>

 {/* Dark basemap without a second tile URL. OSM ships one style, so the tile
     container — and ONLY the tile container — is inverted. Leaflet renders
     markers, popups and controls in sibling panes, so the gold divIcons and
     the attribution credit are untouched by this and stay legible.
     hue-rotate puts the inverted blues back to blue rather than orange. */}
 <style>{`
   .harvest-tiles-dark {
     filter: invert(1) hue-rotate(180deg) brightness(0.92) contrast(0.9);
   }
 `}</style>

 {/* Map is always mounted (never display:none) so leaflet keeps its size */}
 {/*
      THE-346 · TWO SEPARATE FAULTS, BOTH FIXED HERE, AND PR 476's WORK IS
     UNTOUCHED — `key={mapTheme}`, the OSM URL and the attribution below are
     byte-identical.

     The founder: *"In map I should not be able to zoom out this much."* His
     screenshot shows the world repeating THREE TIMES across, with grey void
     above and below it. Those are not one bug seen twice:

       1. NOTHING SET A FLOOR ON ZOOM. `zoom={2}` is only where the map STARTS;
          Leaflet's own default `minZoom` for a tile layer this shallow lets you
          scroll out to 0, where the whole world is 256px and the rest of the
          container is the grey void behind the tile pane.
       2. NOTHING STOPPED THE WORLD REPEATING. Web Mercator tiles wrap in x by
          default, so once the container is wider than 256·2^z the SAME tiles
          are re-requested for the next copy — and the same church is drawn at
          the same longitude in each one. `worldCopyJump` does NOT fix this and
          was never the lever: it changes what PANNING does across the seam, not
          whether the seam exists. `noWrap` on the TileLayer is the lever.

      `minZoom={2}` IS A FLOOR, NOT THE WHOLE ANSWER, because the width that
     shows a whole world is not fixed: 256·2^2 = 1024px of world covers 380 and
     768 with room to spare and leaves 416px of void at 1440. So the floor is
     RAISED TO FIT THE CONTAINER at run time, in the `mapRef` effect below,
     via Leaflet's own `getBoundsZoom` — which is width-adaptive by
     construction, and so answers the ticket's warning that width is not
     monotonic without a table of magic numbers per breakpoint.

     `maxBounds` + `maxBoundsViscosity={1}` is what keeps the single world put
     once you cannot zoom out past it: without them you can still PAN off the
     edge into the void that zooming can no longer reach.

      THE-342's distance filter is unaffected and was checked rather than
     assumed: it bounds which churches are READ, by radius from the member, and
     never reads the map's zoom or bounds. A zoom floor changes what is drawn,
     not what is fetched, so the two do not interact.
 */}
 <MapContainer
 center={[20, 0]}
 zoom={2} 
 minZoom={2}
 maxBounds={WORLD_BOUNDS}
 maxBoundsViscosity={1}
 style={{ height: '100%', width: '100%', zIndex: 0 }}
 zoomControl={false}
 >
 {/* OpenStreetMap's own tiles: no API key, no account, no paid tier — and,
     unlike every keyed alternative, nothing to renew or lose.

     Why not CARTO any more: CARTO began serving an "API KEY REQUIRED"
     watermark over unauthenticated raster tiles in Aug 2026. Nothing errored
     and nothing logged, which is why this went unnoticed in production. A free
     CARTO key would fix the watermark, but CARTO has said raster basemaps are
     being RETIRED, so a key buys time rather than a home. MapTiler's free tier
     is explicitly non-commercial and so cannot serve Harvest at all.

     What OSM's tile policy requires of us, and where each is honoured:
       · visible attribution — attributionControl is no longer false, and the
         credit below is what it renders. This is the one VISIBLE change.
       · one host — the a/b/c subdomains are deprecated in favour of
         tile.openstreetmap.org, so there is no {s} here and no {r}, since OSM
         serves no @2x tile.
       · no bulk pre-fetch and no offline seeding — this map only ever requests
         the tiles the user is actively viewing, so it already complies.

     OSM publishes ONE style, so dark is produced by inverting the tile pane
     rather than by a second URL. The filter is scoped to the tile pane, so the
     gold divIcon markers — which leaflet puts in the MARKER pane — keep their
     --brand-color and stay legible on both themes.

     `key` is what makes it follow a theme TOGGLE rather than only the initial
     load: react-leaflet creates the underlying L.TileLayer once on mount and
     does not re-issue tiles when its props change, so the layer has to be
     remounted. Without this the map stays light until a full reload. */}
 <TileLayer
 key={mapTheme}
 url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
 attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
 noWrap
 bounds={WORLD_BOUNDS}
 className={mapTheme === 'dark' ? 'harvest-tiles-dark' : undefined}
 />
 <MapReady onReady={setMapRef} />
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

 {/* Locate button — stable overlay anchored to the map wrapper (hidden on mobile list view) */}
 {mapRef && (
 <div className={`absolute right-4 top-20 lg:top-6 lg:right-6 z-[1000] ${viewMode === 'list' ? 'hidden lg:block' : 'block'}`}>
 <LocationButton map={mapRef} setUserLocation={setUserLocation} />
 </div>
 )}

 {/* Re-open the church list (desktop only, shown when collapsed) */}
 {listCollapsed && (
 <button
 onClick={() => setListCollapsed(false)}
 className="hidden lg:flex absolute top-6 left-6 z-[1000] items-center gap-2 bg-surface-raised pl-3 pr-4 py-2.5 rounded-full shadow-md text-body hover:text-gold transition-colors"
 title="Show church list"
 aria-label="Show church list"
 >
 <List size={20} />
 <span className="text-sm font-semibold">Churches</span>
 </button>
 )}

 {/* Church list — full-screen overlay on mobile (list mode); fixed left panel on desktop */}
 <div className={`${viewMode === 'list' ? 'block' : 'hidden'} ${listCollapsed ? 'lg:hidden' : 'lg:block'} absolute inset-0 lg:inset-y-0 lg:left-0 lg:right-auto lg:w-[380px] bg-surface-raised overflow-y-auto pt-24 lg:pt-6 px-4 pb-6 z-[500] lg:shadow-[4px_0_16px_rgba(0,0,0,0.06)]`}>
 <div className="w-full max-w-2xl mx-auto lg:max-w-none lg:mx-0">
 <div className="hidden lg:flex items-center justify-between sticky top-0 bg-surface-raised pb-3 mb-1 z-10">
 <h2 className="text-lg font-bold text-strong font-display">Churches near you</h2>
 <button
 onClick={() => setListCollapsed(true)}
 className="w-8 h-8 -mr-1 rounded-lg flex items-center justify-center text-faint hover:text-body hover:bg-surface-sunken transition-colors"
 title="Collapse list"
 aria-label="Collapse church list"
 >
 <ChevronLeft size={20} />
 </button>
 </div>
 <div className="space-y-4">
 {/*
   A truncated finder SAYS SO, with an EXACT total from getCountFromServer.
   It matters more here than anywhere else in this ticket: a visitor reads
   a short list as "there is no church near me" and stops looking.
 */}
 {churchesTruncated && (
 <Alert data-churches-truncated>
 <AlertTitle>This list is incomplete</AlertTitle>
 <AlertDescription>
 {churchesTruncated} Zoom the map or search to find one that is not shown.
 </AlertDescription>
 </Alert>
 )}
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
 className={`bg-surface-raised rounded-2xl p-3 flex gap-3 shadow-xs transition-all duration-500 cursor-pointer ${
 isHighlighted 
 ? 'border-2 border-gold ring-4 ring-[color-mix(in_srgb,var(--brand-color)_20%,transparent)] scale-[1.02]' 
 : 'border border-line '
 }`}
 >
 <div className="w-20 h-20 rounded-xl bg-surface-chip flex-shrink-0 overflow-hidden relative">
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
 <h3 className="font-bold text-base text-strong flex items-center gap-1 leading-tight">
 {church.name}
 <CheckCircle size={12} className="text-gold flex-shrink-0" />
 </h3>
 <span className="text-xs font-semibold text-faint whitespace-nowrap ml-2">
 {distanceStr}
 </span>
 </div>
 <p className="text-xs text-muted mt-0.5 line-clamp-1">
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
 className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors shadow-xs ${
 isHome 
 ? 'bg-gold text-white' 
 : 'bg-surface-raised text-muted border border-line hover:bg-surface-sunken'
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
 className="w-8 h-8 rounded-lg bg-gold flex items-center justify-center shadow-xs hover:bg-[color-mix(in_srgb,var(--brand-color)_85%,black)] transition-colors text-white"
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
 
 {/*
 THE-342 — the FAILURE state, checked BEFORE the empty state below.
 "No verified churches found in your area" is a claim about the world;
 rendering it because the query threw is the exact quiet lie AGENTS.md's
 Silent-Failure Rule names. The `alert` primitive supplies role="alert"
 and the tokened surface — a hand-rolled div would be a defect here.
 */}
 {churchesFailed ? (
 <Alert data-churches-read-failed variant="destructive" className="my-8">
 <AlertTitle>We could not load the church map</AlertTitle>
 <AlertDescription>
 This is not a list of the churches near you — the search did not
 complete. Please try again in a moment.
 </AlertDescription>
 </Alert>
 ) : churches.length === 0 && (
 <div className="text-center py-12">
 <p className="text-muted ">No verified churches found in your area.</p>
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