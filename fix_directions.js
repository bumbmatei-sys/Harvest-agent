const fs = require('fs');
const path = './src/components/ChurchDetailsModal.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace('<Navigation size={24} className="transform rotate-45" />', 'Directions');

fs.writeFileSync(path, content);
console.log('Successfully updated ChurchDetailsModal.tsx');
