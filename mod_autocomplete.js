import fs from 'fs';

let text = fs.readFileSync('src/components/ChurchEnrollment.tsx', 'utf8');

const autocompleteCode = `
          <div className="mb-6 mt-4">
            <label className="block text-sm font-bold text-gray-700 mb-2 whitespace-nowrap"><Search size={18} className="inline mr-1 -mt-0.5" />Search Church with Google Places</label>
            <Autocomplete
              apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}
              onPlaceSelected={(place) => {
                let newFormData = { ...text.formData }; // wait, the component's state is formData. 
                // We'll replace it correctly in the code instead.
              }}
              options={{
                types: ['establishment'],
              }}
              className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
              placeholder="Start typing to auto-fill..."
            />
          </div>
`;

// regex replace
const replaced = text.replace(
  /(Church Details\s*<\/h3>)/m,
  "$1\n" + `
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
`
);

fs.writeFileSync('src/components/ChurchEnrollment.tsx', replaced);
