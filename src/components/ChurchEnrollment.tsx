"use client";
import React, { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import { collection, addDoc, doc, updateDoc, getDoc } from 'firebase/firestore';
import { Church, MapPin, Calendar, Trash2, Plus, User, Globe, Send, AlertCircle } from 'lucide-react';
import Autocomplete from "react-google-autocomplete";



import { ImageUpload } from './ImageUpload';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope } from '../utils/tenant-scope';


interface ChurchEnrollmentProps {
 onBack: () => void;
 initialData?: any;
 onSave?: (data?: { id: string; name: string }) => void;
}

const ChurchEnrollment: React.FC<ChurchEnrollmentProps> = ({ onBack, initialData, onSave }) => {
 const [formData, setFormData] = useState({
 churchName: '',
 denomination: '',
 contactName: '',
 contactEmail: '',
 contactPhone: '',
 street: '',
 number: '',
 city: '',
 state: '',
 zipcode: '',
 country: '',
 lat: '',
 lng: '',
 website: '',
 facebook: '',
 instagram: '',
 imageUrl: '',
 services: [{ day: 'Sunday', time: '10:00 AM', name: 'Main Service' }]
 });

 useEffect(() => {
 if (initialData) {
 setFormData({
 churchName: initialData.name || '',
 denomination: initialData.denomination || '',
 contactName: initialData.contactName || '',
 contactEmail: initialData.contactEmail || '',
 contactPhone: initialData.contactPhone || '',
 street: initialData.street || '',
 number: initialData.number || '',
 city: initialData.city || '',
 state: initialData.state || '',
 zipcode: initialData.zipcode || '',
 country: initialData.country || '',
 lat: initialData.lat?.toString() || '',
 lng: initialData.lng?.toString() || '',
 website: initialData.website || '',
 facebook: initialData.facebook || '',
 instagram: initialData.instagram || '',
 imageUrl: initialData.imageUrl || '',
 services: initialData.services || [{ day: 'Sunday', time: '10:00 AM', name: 'Main Service' }]
 });
 }
 }, [initialData]);

 const [isSubmitting, setIsSubmitting] = useState(false);
 const [error, setError] = useState<string | null>(null);

 const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
 const { name, value } = e.target;
 setFormData(prev => ({
 ...prev,
 [name]: value
 }));
 };

 const handleServiceChange = (index: number, field: string, value: string) => {
 const newServices = [...formData.services];
 newServices[index] = { ...newServices[index], [field]: value };
 setFormData(prev => ({ ...prev, services: newServices }));
 };

 const handleAddService = () => {
 setFormData(prev => ({
 ...prev,
 services: [...prev.services, { day: 'Sunday', time: '', name: '' }]
 }));
 };

 const handleRemoveService = (index: number) => {
 const newServices = [...formData.services];
 newServices.splice(index, 1);
 setFormData(prev => ({ ...prev, services: newServices }));
 };

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 setIsSubmitting(true);
 setError(null);

 try {
 let lat = parseFloat(formData.lat);
 let lng = parseFloat(formData.lng);
 
 if (isNaN(lat) || isNaN(lng)) {
 // Fallback to geocoding if lat/lng are not provided or invalid
 const address = `${formData.street} ${formData.number}, ${formData.city}, ${formData.state}, ${formData.zipcode}, ${formData.country}`;
 try {
 const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`);
 const data = await response.json();
 if (data && data.length > 0 && data[0].lat && data[0].lon) {
   lat = parseFloat(data[0].lat) || 0;
   lng = parseFloat(data[0].lon) || 0;
 } else {
   console.warn('Geocoding returned no results for address:', address);
   setError('Location could not be determined from the address. Please enter latitude and longitude manually.');
   lat = 0;
   lng = 0;
 }
 } catch (geoError) {
 console.error("Geocoding error:", geoError);
 console.warn('Geocoding request failed for address:', address);
 setError('Location service is unavailable. Please enter latitude and longitude manually.');
 lat = 0;
 lng = 0;
 }
 }

 const churchData = {
 name: formData.churchName,
 denomination: formData.denomination,
 contactName: formData.contactName,
 contactEmail: formData.contactEmail,
 contactPhone: formData.contactPhone,
 street: formData.street,
 number: formData.number,
 city: formData.city,
 state: formData.state,
 zipcode: formData.zipcode,
 country: formData.country,
 website: formData.website,
 facebook: formData.facebook,
 instagram: formData.instagram,
 imageUrl: formData.imageUrl,
 pastorName: formData.contactName, // Assuming contact is pastor
 services: formData.services,
 lat,
 lng
 };

 if (initialData?.id) {
   const tenantId = await getTenantScope();
   if (tenantId) {
     const docSnap = await getDoc(doc(db, 'churches', initialData.id));
     if (docSnap.exists() && docSnap.data().tenantId && docSnap.data().tenantId !== tenantId) {
       console.error('Tenant mismatch');
       return;
     }
   }
   await updateDoc(doc(db, 'churches', initialData.id), churchData);
 if (onSave) onSave({ id: initialData.id, name: churchData.name || '' });
 } else {
   const tenantId = await getTenantScope();
   const ref = await addDoc(collection(db, 'churches'), {
     ...churchData,
     status: 'active',
     createdAt: new Date().toISOString(),
     userId: auth.currentUser?.uid || null,
     tenantId: tenantId || null
   });
 if (onSave) onSave({ id: ref.id, name: churchData.name || '' });
 }
 } catch (err) {
 try { handleFirestoreError(err, OperationType.WRITE, `churches`); } catch (e) { console.error(e); }
 if (err instanceof Error) {
 setError(`Failed to submit: ${err.message}`);
 } else {
 setError("Something went wrong. Please try again later.");
 }
 } finally {
 setIsSubmitting(false);
 }
 };

 return (
 <div className="w-full">
 {error && (
 <div className="mb-8 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-3">
 <AlertCircle size={24} />
 <p>{error}</p>
 </div>
 )}
 <form className="space-y-10" onSubmit={handleSubmit}>
 
 {/* Section 1: Church Details */}
 <div className="space-y-6">
 <h3 className="text-lg font-bold text-background-dark border-b border-gray-100 pb-3 flex items-center gap-2 font-display">
 <Church className="text-primary" size={24} />
 Church Details
 </h3>

          <div className="mt-4 mb-2">
            <label className="block text-sm font-bold text-gray-700 mb-2">Search Church with Google Maps API</label>
            <Autocomplete
              apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}
              onPlaceSelected={(place) => {
                let newFormData = { ...formData };
                if (place.name) newFormData.churchName = place.name;
                if (place.formatted_phone_number || place.international_phone_number) {
                  newFormData.contactPhone = place.formatted_phone_number || place.international_phone_number;
                }
                if (place.website) newFormData.website = place.website;
                if (place.geometry && place.geometry.location) {
                  newFormData.lat = place.geometry.location.lat().toString();
                  newFormData.lng = place.geometry.location.lng().toString();
                }

                place.address_components?.forEach(component => {
                  const types = component.types;
                  if (types.includes('street_number')) newFormData.number = component.long_name;
                  if (types.includes('route')) newFormData.street = component.long_name;
                  if (types.includes('locality') || types.includes('postal_town')) newFormData.city = component.long_name;
                  if (types.includes('administrative_area_level_1')) newFormData.state = component.long_name;
                  if (types.includes('country')) newFormData.country = component.long_name;
                  if (types.includes('postal_code')) newFormData.zipcode = component.long_name;
                });

                setFormData(newFormData);
              }}
              options={{
                types: ['establishment'],
              }}
              className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
              placeholder="Start typing to auto-fill..."
            />
          </div>

 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 <div>
 <label className="block text-sm font-bold text-gray-700 mb-2">Church Name <span className="text-red-500">*</span></label>
 <input 
 required 
 type="text" 
 name="churchName"
 value={formData.churchName}
 onChange={handleChange}
 className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
 placeholder="e.g. Grace Community Church" 
 />
 </div>
 <div>
 <label className="block text-sm font-bold text-gray-700 mb-2">Denomination <span className="text-gray-400 font-normal">(Optional)</span></label>
 <input 
 type="text" 
 name="denomination"
 value={formData.denomination}
 onChange={handleChange}
 className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
 placeholder="e.g. Non-denominational" 
 />
 </div>
 <div className="md:col-span-2">
 <label className="block text-sm font-bold text-gray-700 mb-2">Church Image <span className="text-gray-400 font-normal">(Optional)</span></label>
 <ImageUpload 
 value={formData.imageUrl} 
 onChange={(url) => setFormData(prev => ({ ...prev, imageUrl: url }))} 
 placeholder="Upload or paste image URL" 
 />
 </div>
 </div>
 </div>

 {/* Section 2: Location */}
 <div className="space-y-6">
 <h3 className="text-lg font-bold text-background-dark border-b border-gray-100 pb-3 flex items-center gap-2 font-display">
 <MapPin className="text-primary" size={24} />
 Location
 </h3>
 
 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
 <div className="md:col-span-2">
 <label className="block text-sm font-bold text-gray-700 mb-2">Street <span className="text-red-500">*</span></label>
 <input 
 required 
 type="text" 
 name="street"
 value={formData.street}
 onChange={handleChange}
 className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
 placeholder="Street Name" 
 />
 </div>
 <div>
 <label className="block text-sm font-bold text-gray-700 mb-2">Number <span className="text-red-500">*</span></label>
 <input 
 required 
 type="text" 
 name="number"
 value={formData.number}
 onChange={handleChange}
 className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
 placeholder="Building/Apt" 
 />
 </div>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
 <div>
 <label className="block text-sm font-bold text-gray-700 mb-2">City <span className="text-red-500">*</span></label>
 <input 
 required 
 type="text" 
 name="city"
 value={formData.city}
 onChange={handleChange}
 className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
 placeholder="City" 
 />
 </div>
 <div>
 <label className="block text-sm font-bold text-gray-700 mb-2">State/Province <span className="text-red-500">*</span></label>
 <input 
 required 
 type="text" 
 name="state"
 value={formData.state}
 onChange={handleChange}
 className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
 placeholder="State or Province" 
 />
 </div>
 <div>
 <label className="block text-sm font-bold text-gray-700 mb-2">Zipcode <span className="text-red-500">*</span></label>
 <input 
 required 
 type="text" 
 name="zipcode"
 value={formData.zipcode}
 onChange={handleChange}
 className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
 placeholder="Postal Code" 
 />
 </div>
 <div>
 <label className="block text-sm font-bold text-gray-700 mb-2">Country <span className="text-red-500">*</span></label>
 <input 
 required 
 type="text" 
 name="country"
 value={formData.country}
 onChange={handleChange}
 className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
 placeholder="Country" 
 />
 </div>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 <div>
 <label className="block text-sm font-bold text-gray-700 mb-2">Latitude <span className="text-gray-400 font-normal">(Optional - For map display)</span></label>
 <input 
 type="text" 
 name="lat"
 value={formData.lat}
 onChange={handleChange}
 className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
 placeholder="e.g. 40.7128" 
 />
 </div>
 <div>
 <label className="block text-sm font-bold text-gray-700 mb-2">Longitude <span className="text-gray-400 font-normal">(Optional - For map display)</span></label>
 <input 
 type="text" 
 name="lng"
 value={formData.lng}
 onChange={handleChange}
 className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
 placeholder="e.g. -74.0060" 
 />
 </div>
 </div>
 </div>

 {/* Section: Weekly Services */}
 <div className="space-y-6">
 <h3 className="text-lg font-bold text-background-dark border-b border-gray-100 pb-3 flex items-center gap-2 font-display">
 <Calendar className="text-primary" size={24} />
 Weekly Services
 </h3>
 <p className="text-sm text-gray-500 mb-4">Add the regular services and meetings throughout the week.</p>
 
 <div className="space-y-4">
 {formData.services.map((service, index) => (
 <div key={index} className="flex flex-col md:flex-row gap-4 items-start md:items-center bg-gray-50 p-4 rounded-xl border border-gray-100">
 <div className="w-full md:w-1/4">
 <label className="block text-xs font-bold text-gray-700 mb-1">Day</label>
 <select 
 value={service.day}
 onChange={(e) => handleServiceChange(index, 'day', e.target.value)}
 className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
 >
 <option value="Sunday">Sunday</option>
 <option value="Monday">Monday</option>
 <option value="Tuesday">Tuesday</option>
 <option value="Wednesday">Wednesday</option>
 <option value="Thursday">Thursday</option>
 <option value="Friday">Friday</option>
 <option value="Saturday">Saturday</option>
 </select>
 </div>
 <div className="w-full md:w-1/4">
 <label className="block text-xs font-bold text-gray-700 mb-1">Time</label>
 <input 
 type="text" 
 value={service.time}
 onChange={(e) => handleServiceChange(index, 'time', e.target.value)}
 className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
 placeholder="e.g. 10:00 AM" 
 />
 </div>
 <div className="w-full md:w-2/4">
 <label className="block text-xs font-bold text-gray-700 mb-1">Service Name</label>
 <div className="flex gap-2">
 <input 
 type="text" 
 value={service.name}
 onChange={(e) => handleServiceChange(index, 'name', e.target.value)}
 className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
 placeholder="e.g. Main Service, Youth Group" 
 />
 {formData.services.length > 1 && (
 <button 
 type="button"
 onClick={() => handleRemoveService(index)}
 className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
 >
 <Trash2 size={24} />
 </button>
 )}
 </div>
 </div>
 </div>
 ))}
 </div>
 <button 
 type="button"
 onClick={handleAddService}
 className="text-primary font-medium flex items-center gap-1 hover:text-primary-dark transition-colors text-sm"
 >
 <Plus className="text-sm" size={16} />
 Add another service
 </button>
 </div>

 {/* Section 3: Contact Person */}
 <div className="space-y-6">
 <h3 className="text-lg font-bold text-background-dark border-b border-gray-100 pb-3 flex items-center gap-2 font-display">
 <User className="text-primary" size={24} />
 Contact Person
 </h3>
 <div>
 <label className="block text-sm font-bold text-gray-700 mb-2">Full Name <span className="text-red-500">*</span></label>
 <input 
 required 
 type="text" 
 name="contactName"
 value={formData.contactName}
 onChange={handleChange}
 className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
 placeholder="Lead Pastor or Administrator" 
 />
 </div>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 <div>
 <label className="block text-sm font-bold text-gray-700 mb-2">Email Address <span className="text-red-500">*</span></label>
 <input 
 required 
 type="email" 
 name="contactEmail"
 value={formData.contactEmail}
 onChange={handleChange}
 className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
 placeholder="contact@church.org" 
 />
 </div>
 <div>
 <label className="block text-sm font-bold text-gray-700 mb-2">Phone Number <span className="text-red-500">*</span></label>
 <input 
 required 
 type="tel" 
 name="contactPhone"
 value={formData.contactPhone}
 onChange={handleChange}
 className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
 placeholder="+1 (555) 000-0000" 
 />
 </div>
 </div>
 </div>

 {/* Section 4: Social Links */}
 <div className="space-y-6">
 <h3 className="text-lg font-bold text-background-dark border-b border-gray-100 pb-3 flex items-center gap-2 font-display">
 <Globe className="text-primary" size={24} />
 Online Presence
 </h3>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 <div>
 <label className="block text-sm font-bold text-gray-700 mb-2">Website</label>
 <div className="relative">
 <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
 <Globe size={20} />
 </div>
 <input 
 type="url" 
 name="website"
 value={formData.website}
 onChange={handleChange}
 className="w-full pl-12 pr-4 py-3 rounded-xl border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
 placeholder="https://www.yourchurch.com" 
 />
 </div>
 </div>
 <div>
 <label className="block text-sm font-bold text-gray-700 mb-2">Facebook</label>
 <div className="relative">
 <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-lg">f</div>
 <input 
 type="url" 
 name="facebook"
 value={formData.facebook}
 onChange={handleChange}
 className="w-full pl-12 pr-4 py-3 rounded-xl border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
 placeholder="facebook.com/page" 
 />
 </div>
 </div>
 <div>
 <label className="block text-sm font-bold text-gray-700 mb-2">Instagram</label>
 <div className="relative">
 <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-lg">@</div>
 <input 
 type="text" 
 name="instagram"
 value={formData.instagram}
 onChange={handleChange}
 className="w-full pl-12 pr-4 py-3 rounded-xl border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
 placeholder="username" 
 />
 </div>
 </div>
 </div>
 </div>

 <div className="pt-4 flex flex-col sm:flex-row gap-4">
 <button 
 type="submit" 
 disabled={isSubmitting}
 className={`flex-1 bg-primary text-white font-bold py-4 rounded-xl hover:bg-yellow-600 transition-colors shadow-lg shadow-primary/20 flex items-center justify-center gap-2 ${isSubmitting ? 'opacity-70 cursor-not-allowed' : ''}`}
 >
 {isSubmitting ? (
 <>
 <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
 {initialData ? 'Saving...' : 'Submitting...'}
 </>
 ) : (
 <>
 {initialData ? 'Save Changes' : 'Submit Church'}
 <Send size={24} />
 </>
 )}
 </button>
 </div>
 </form>
 </div>
 );
};

export default ChurchEnrollment;